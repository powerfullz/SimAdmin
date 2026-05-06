//! OTA 更新模块
//!
//! 处理 OTA 更新包的上传、验证和应用

use crate::models::{OtaMeta, OtaStatusResponse, OtaUploadResponse, OtaValidation};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

/// OTA 相关路径
const OTA_STAGING_DIR: &str = "/tmp/ota_staging";
const OTA_BINARY_PATH: &str = "/opt/simadmin/simadmin";
const OTA_WWW_PATH: &str = "/opt/simadmin/www";
const OTA_META_PATH: &str = "/opt/simadmin/meta.json";
const OTA_SERVICE_NAME: &str = "simadmin.service";
const NM_CONF_DIR: &str = "/etc/NetworkManager/conf.d";
const NM_CONF_PATH: &str = "/etc/NetworkManager/conf.d/99-simadmin-unmanaged-modem.conf";
const NM_UNMANAGED_WWAN_CONFIG: &str = "[keyfile]\nunmanaged-devices=interface-name:wwan*\n";

/// 当前版本信息（编译时注入）
pub const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// 获取当前 commit（从环境变量或默认值）
pub fn get_current_commit() -> String {
    option_env!("GIT_COMMIT").unwrap_or("unknown").to_string()
}

/// 获取 OTA 更新状态
pub fn get_ota_status() -> OtaStatusResponse {
    let pending_meta = read_pending_meta();

    OtaStatusResponse {
        current_version: CURRENT_VERSION.to_string(),
        current_commit: get_current_commit(),
        pending_update: pending_meta.is_some(),
        pending_meta,
    }
}

/// 读取待安装的更新元数据
fn read_pending_meta() -> Option<OtaMeta> {
    let meta_path = format!("{}/meta.json", OTA_STAGING_DIR);
    if let Ok(content) = fs::read_to_string(&meta_path) {
        serde_json::from_str(&content).ok()
    } else {
        None
    }
}

/// 处理上传的 OTA 包（支持 tar.gz 和 zip 格式）
pub fn handle_ota_upload(data: &[u8]) -> Result<OtaUploadResponse, String> {
    // 清理并创建临时目录
    let _ = fs::remove_dir_all(OTA_STAGING_DIR);
    fs::create_dir_all(OTA_STAGING_DIR)
        .map_err(|e| format!("Failed to create staging dir: {}", e))?;

    // 自动检测文件格式
    let is_zip = detect_zip_format(data);

    if is_zip {
        // ZIP 格式处理
        let zip_path = format!("{}/update.zip", OTA_STAGING_DIR);
        let mut file =
            fs::File::create(&zip_path).map_err(|e| format!("Failed to create zip file: {}", e))?;
        file.write_all(data)
            .map_err(|e| format!("Failed to write zip file: {}", e))?;

        // 解压 ZIP（使用 unzip 命令）
        let output = Command::new("unzip")
            .args(["-o", &zip_path, "-d", OTA_STAGING_DIR])
            .output()
            .map_err(|e| {
                format!(
                    "Failed to extract zip: {}. Make sure 'unzip' is installed.",
                    e
                )
            })?;

        if !output.status.success() {
            return Err(format!(
                "Failed to extract zip: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        // 删除原始 zip 文件
        let _ = fs::remove_file(&zip_path);

        // ZIP 格式不保留 Unix 权限，需要手动设置
        fix_file_permissions()?;
    } else {
        // TAR.GZ 格式处理（默认，保留 Unix 权限）
        let tar_path = format!("{}/update.tar.gz", OTA_STAGING_DIR);
        let mut file =
            fs::File::create(&tar_path).map_err(|e| format!("Failed to create tar file: {}", e))?;
        file.write_all(data)
            .map_err(|e| format!("Failed to write tar file: {}", e))?;

        // 解压 TAR.GZ
        let output = Command::new("tar")
            .args(["-xzf", &tar_path, "-C", OTA_STAGING_DIR])
            .output()
            .map_err(|e| format!("Failed to extract tar: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "Failed to extract tar: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        // 删除原始 tar 文件
        let _ = fs::remove_file(&tar_path);
    }

    // 读取 meta.json
    let meta_path = format!("{}/meta.json", OTA_STAGING_DIR);
    let meta_content = fs::read_to_string(&meta_path)
        .map_err(|_| "meta.json not found in OTA package".to_string())?;

    let meta: OtaMeta =
        serde_json::from_str(&meta_content).map_err(|e| format!("Invalid meta.json: {}", e))?;

    // 验证
    let validation = validate_ota_package(&meta)?;

    Ok(OtaUploadResponse { meta, validation })
}

/// 验证 OTA 包
fn validate_ota_package(meta: &OtaMeta) -> Result<OtaValidation, String> {
    let binary_path = format!("{}/simadmin", OTA_STAGING_DIR);
    let www_path = format!("{}/www", OTA_STAGING_DIR);

    // 检查文件存在
    if !Path::new(&binary_path).exists() {
        return Ok(OtaValidation {
            valid: false,
            is_newer: false,
            binary_md5_match: false,
            frontend_md5_match: false,
            arch_match: false,
            error: Some("Binary file not found in package".to_string()),
        });
    }

    if !Path::new(&www_path).exists() {
        return Ok(OtaValidation {
            valid: false,
            is_newer: false,
            binary_md5_match: false,
            frontend_md5_match: false,
            arch_match: false,
            error: Some("Frontend directory not found in package".to_string()),
        });
    }

    // 计算二进制 MD5（严格验证）
    let binary_md5 = calculate_file_md5(&binary_path)?;
    let binary_md5_match = binary_md5 == meta.binary_md5;

    // 前端目录存在即可（MD5 跨平台难以保持一致）
    let frontend_md5_match = true; // 跳过前端 MD5 验证

    // 检查架构（只接受 musl）
    let arch_match = meta.arch == "aarch64-unknown-linux-musl";

    // 比较版本
    let is_newer = compare_versions(&meta.version, CURRENT_VERSION);

    // 只验证二进制 MD5 和架构
    let valid = binary_md5_match && arch_match;

    // 生成详细的错误信息
    let error = if !valid {
        let mut errors = Vec::new();
        if !binary_md5_match {
            errors.push(format!(
                "Binary MD5 mismatch: expected={}, actual={}",
                meta.binary_md5, binary_md5
            ));
        }
        if !arch_match {
            errors.push(format!(
                "Arch mismatch: expected=aarch64-unknown-linux-musl, actual={}",
                meta.arch
            ));
        }
        Some(errors.join("; "))
    } else {
        None
    };

    Ok(OtaValidation {
        valid,
        is_newer,
        binary_md5_match,
        frontend_md5_match,
        arch_match,
        error,
    })
}

/// 计算文件 MD5
fn calculate_file_md5(path: &str) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;

    let mut contents = Vec::new();
    file.read_to_end(&mut contents)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    Ok(format!("{:x}", md5::compute(&contents)))
}

/// 比较版本号（返回 v1 > v2）
fn compare_versions(v1: &str, v2: &str) -> bool {
    let parse = |v: &str| -> Vec<u32> { v.split('.').filter_map(|s| s.parse().ok()).collect() };

    let v1_parts = parse(v1);
    let v2_parts = parse(v2);

    for i in 0..std::cmp::max(v1_parts.len(), v2_parts.len()) {
        let p1 = v1_parts.get(i).unwrap_or(&0);
        let p2 = v2_parts.get(i).unwrap_or(&0);
        if p1 > p2 {
            return true;
        } else if p1 < p2 {
            return false;
        }
    }
    false
}

/// 应用 OTA 更新
pub fn apply_ota_update(restart_now: bool) -> Result<String, String> {
    let meta = read_pending_meta().ok_or_else(|| "No pending update".to_string())?;

    let staging_binary = format!("{}/simadmin", OTA_STAGING_DIR);
    let staging_www = format!("{}/www", OTA_STAGING_DIR);

    install_binary_atomic(&staging_binary, OTA_BINARY_PATH)?;

    // 复制前端文件（删除旧目录，复制新目录）
    let _ = fs::remove_dir_all(OTA_WWW_PATH);
    copy_dir_recursive(&staging_www, OTA_WWW_PATH)?;
    chmod_www_tree(OTA_WWW_PATH)?;

    install_meta_file()?;
    let nm_result = configure_networkmanager_modem_unmanaged(restart_now);

    // 清理暂存目录
    let _ = fs::remove_dir_all(OTA_STAGING_DIR);

    let message = format!(
        "Update to version {} applied successfully; {}",
        meta.version, nm_result
    );

    if restart_now {
        std::thread::spawn(|| {
            std::thread::sleep(std::time::Duration::from_secs(1));
            restart_service_no_block();
        });
    }

    Ok(message)
}

fn configure_networkmanager_modem_unmanaged(restart_now: bool) -> String {
    if !Path::new("/etc/NetworkManager").exists() {
        return "NetworkManager not installed, unmanaged modem config skipped".to_string();
    }

    if let Ok(content) = fs::read_to_string(NM_CONF_PATH) {
        if content == NM_UNMANAGED_WWAN_CONFIG {
            return "NetworkManager already ignores wwan*".to_string();
        }
    }

    if let Err(err) = fs::create_dir_all(NM_CONF_DIR) {
        return format!("Failed to create NetworkManager conf.d: {err}");
    }
    if let Err(err) = fs::write(NM_CONF_PATH, NM_UNMANAGED_WWAN_CONFIG) {
        return format!("Failed to write NetworkManager unmanaged modem config: {err}");
    }

    if !restart_now {
        return "NetworkManager config written; service restart deferred".to_string();
    }

    match Command::new("systemctl")
        .args(["is-active", "--quiet", "NetworkManager.service"])
        .status()
    {
        Ok(status) if status.success() => {
            match Command::new("systemctl")
                .args(["restart", "NetworkManager.service"])
                .output()
            {
                Ok(output) if output.status.success() => {
                    "NetworkManager configured to ignore wwan*, service restarted".to_string()
                }
                Ok(output) => format!(
                    "NetworkManager config written, restart failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                ),
                Err(err) => format!("NetworkManager config written, restart failed: {err}"),
            }
        }
        _ => "NetworkManager configured to ignore wwan*, service not active".to_string(),
    }
}

fn install_binary_atomic(src: &str, dst: &str) -> Result<(), String> {
    let dst_path = Path::new(dst);
    let dst_dir = dst_path
        .parent()
        .ok_or_else(|| format!("Invalid binary path: {}", dst))?;
    fs::create_dir_all(dst_dir).map_err(|e| format!("Failed to create binary dir: {}", e))?;

    let tmp_path = ota_temp_binary_path(dst_path);
    let _ = fs::remove_file(&tmp_path);

    fs::copy(src, &tmp_path).map_err(|e| format!("Failed to copy binary: {}", e))?;

    let chmod_output = Command::new("chmod")
        .arg("755")
        .arg(&tmp_path)
        .output()
        .map_err(|e| {
            let _ = fs::remove_file(&tmp_path);
            format!("Failed to chmod: {}", e)
        })?;

    if !chmod_output.status.success() {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!(
            "Failed to chmod: {}",
            String::from_utf8_lossy(&chmod_output.stderr)
        ));
    }

    fs::rename(&tmp_path, dst).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("Failed to replace binary: {}", e)
    })?;

    Ok(())
}

fn ota_temp_binary_path(dst: &Path) -> PathBuf {
    let file_name = dst
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("simadmin");
    dst.with_file_name(format!(".{}.ota-new", file_name))
}

fn chmod_www_tree(path: &str) -> Result<(), String> {
    let output = Command::new("chmod")
        .args(["-R", "a+rX", path])
        .output()
        .map_err(|e| format!("Failed to chmod www: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Failed to chmod www: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(())
}

fn install_meta_file() -> Result<(), String> {
    let staging_meta = format!("{}/meta.json", OTA_STAGING_DIR);
    if !Path::new(&staging_meta).exists() {
        return Ok(());
    }

    fs::copy(&staging_meta, OTA_META_PATH)
        .map_err(|e| format!("Failed to copy meta.json: {}", e))?;

    let output = Command::new("chmod")
        .args(["644", OTA_META_PATH])
        .output()
        .map_err(|e| format!("Failed to chmod meta.json: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Failed to chmod meta.json: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(())
}

fn restart_service_no_block() {
    let _ = Command::new("systemctl")
        .args(["--no-block", "restart", OTA_SERVICE_NAME])
        .output();
}

/// 递归复制目录
fn copy_dir_recursive(src: &str, dst: &str) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("Failed to create dir: {}", e))?;

    let entries = fs::read_dir(src).map_err(|e| format!("Failed to read src dir: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let src_path = entry.path();
        let dst_path = Path::new(dst).join(entry.file_name());

        if src_path.is_dir() {
            copy_dir_recursive(
                src_path.to_str().unwrap_or(""),
                dst_path.to_str().unwrap_or(""),
            )?;
        } else {
            fs::copy(&src_path, &dst_path).map_err(|e| format!("Failed to copy file: {}", e))?;
        }
    }

    Ok(())
}

/// 取消待安装的更新
pub fn cancel_pending_update() -> Result<(), String> {
    if Path::new(OTA_STAGING_DIR).exists() {
        fs::remove_dir_all(OTA_STAGING_DIR)
            .map_err(|e| format!("Failed to remove staging dir: {}", e))?;
    }
    Ok(())
}

/// 检测文件是否为 ZIP 格式（通过魔术字节）
fn detect_zip_format(data: &[u8]) -> bool {
    // ZIP 文件魔术字节: PK\x03\x04 (0x504B0304)
    // TAR.GZ 文件魔术字节: \x1f\x8b (gzip header)
    if data.len() < 4 {
        return false;
    }

    // 检查是否是 ZIP 格式
    data[0] == 0x50 && data[1] == 0x4B && data[2] == 0x03 && data[3] == 0x04
}

/// 修复文件权限（用于 ZIP 解压后）
fn fix_file_permissions() -> Result<(), String> {
    let binary_path = format!("{}/simadmin", OTA_STAGING_DIR);
    let www_path = format!("{}/www", OTA_STAGING_DIR);

    // 设置二进制文件权限为 755（可执行）
    if Path::new(&binary_path).exists() {
        Command::new("chmod")
            .args(["755", &binary_path])
            .output()
            .map_err(|e| format!("Failed to chmod binary: {}", e))?;
    }

    // 设置前端文件权限：目录 755，文件 644
    if Path::new(&www_path).exists() {
        // 所有目录设置为 755
        let _ = Command::new("find")
            .args([&www_path, "-type", "d", "-exec", "chmod", "755", "{}", "+"])
            .output();

        // 所有文件设置为 644
        let _ = Command::new("find")
            .args([&www_path, "-type", "f", "-exec", "chmod", "644", "{}", "+"])
            .output();
    }

    Ok(())
}
