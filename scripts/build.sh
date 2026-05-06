#!/bin/bash

# 构建脚本 - 构建后端和前端，自动生成 OTA 包

set -e

# 切换到项目根目录
cd "$(dirname "$0")/.."

# 解析命令行参数
BUILD_BACKEND=true
BUILD_FRONTEND=true
USE_UPX=true  # 默认启用 UPX 压缩
SKIP_OTA=false

for arg in "$@"; do
    case $arg in
        --backend-only)
            BUILD_FRONTEND=false
            ;;
        --frontend-only)
            BUILD_BACKEND=false
            ;;
        --no-upx)
            USE_UPX=false
            ;;
        --no-ota)
            SKIP_OTA=true
            ;;
        --help|-h)
            echo "用法: ./scripts/build.sh [选项]"
            echo ""
            echo "选项:"
            echo "  --backend-only   只构建后端"
            echo "  --frontend-only  只构建前端"
            echo "  --no-upx         禁用 UPX 压缩 (默认启用)"
            echo "  --no-ota         跳过 OTA 包生成"
            echo "  --help, -h       显示帮助信息"
            echo ""
            echo "示例:"
            echo "  ./scripts/build.sh                    # 构建 + UPX + OTA 包"
            echo "  ./scripts/build.sh --no-upx           # 不压缩"
            echo "  ./scripts/build.sh --no-ota           # 不生成 OTA 包"
            exit 0
            ;;
    esac
done

# ==================== 同步版本号 ====================
VERSION_FILE="VERSION"
if [ -f "$VERSION_FILE" ]; then
    VERSION=$(cat "$VERSION_FILE" | tr -d '[:space:]')
else
    VERSION="3.0.0"
    echo "⚠️  VERSION 文件不存在，使用默认版本: $VERSION"
fi

echo "📦 版本号: $VERSION"

# 更新 package.json 版本号
if [ -f "frontend/package.json" ]; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" frontend/package.json
    else
        sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" frontend/package.json
    fi
fi

# 更新 Cargo.toml 版本号
if [ -f "backend/Cargo.toml" ]; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/^version = \"[^\"]*\"/version = \"$VERSION\"/" backend/Cargo.toml
    else
        sed -i "s/^version = \"[^\"]*\"/version = \"$VERSION\"/" backend/Cargo.toml
    fi
fi

echo ""

# ==================== 构建前端 ====================
if [ "$BUILD_FRONTEND" = true ]; then
    echo "🎨 构建前端..."
    echo ""
    
    cd frontend
    
    # 检查 node_modules
    if [ ! -d "node_modules" ]; then
        echo "📦 安装前端依赖..."
        npm install
    fi
    
    # 构建
    npm run build
    
    cd ..
    
    echo ""
    echo "✅ 前端构建完成！"
    echo "📍 输出目录: frontend/dist/"
    echo ""
fi

# ==================== 构建后端 ====================
if [ "$BUILD_BACKEND" = true ]; then
    echo "🦀 构建后端 (aarch64-unknown-linux-musl)..."
    echo ""

    # 检查交叉编译器
    if ! command -v aarch64-unknown-linux-musl-gcc &> /dev/null; then
        echo "❌ 错误: 未找到 aarch64-unknown-linux-musl-gcc"
        echo ""
        echo "请安装交叉编译工具链:"
        echo "  brew tap messense/macos-cross-toolchains"
        echo "  brew install aarch64-unknown-linux-musl"
        exit 1
    fi
    
    cd backend

    # 设置交叉编译环境变量
    export CC_aarch64_unknown_linux_musl=aarch64-unknown-linux-musl-gcc
    export CXX_aarch64_unknown_linux_musl=aarch64-unknown-linux-musl-g++
    export AR_aarch64_unknown_linux_musl=aarch64-unknown-linux-musl-ar
    export SQLITE3_STATIC=1
    export LIBSQLITE3_SYS_USE_PKG_CONFIG=0

    # 构建
    cargo build --release --target aarch64-unknown-linux-musl

    cd ..

    BINARY_PATH="backend/target/aarch64-unknown-linux-musl/release/simadmin"

    echo ""
    echo "✅ 后端构建完成！"
    echo "📍 二进制文件:"
    ls -lh "$BINARY_PATH"
    
    # UPX 压缩
    if [ "$USE_UPX" = true ]; then
        echo ""
        echo "UPX 压缩..."
    
        if ! command -v upx &> /dev/null; then
            echo "错误: 未找到 upx 命令"
            exit 1
        fi
        BEFORE_SIZE=$(stat -f%z "$BINARY_PATH" 2>/dev/null || stat -c%s "$BINARY_PATH" 2>/dev/null)
        upx --best --lzma "$BINARY_PATH"
        AFTER_SIZE=$(stat -f%z "$BINARY_PATH" 2>/dev/null || stat -c%s "$BINARY_PATH" 2>/dev/null)
        RATIO=$(echo "scale=1; 100 - ($AFTER_SIZE * 100 / $BEFORE_SIZE)" | bc)
        echo "压缩完成！节省: ${RATIO}%"
        ls -lh "$BINARY_PATH"
    fi
    
    echo ""
    echo "📋 文件信息:"
    file "$BINARY_PATH"
fi

# ==================== 生成 OTA 包 ====================
if [ "$SKIP_OTA" = false ] && [ "$BUILD_BACKEND" = true ] && [ "$BUILD_FRONTEND" = true ]; then
    echo ""
    echo "=========================================="
    echo "  生成 OTA 更新包"
    echo "=========================================="
    echo ""
    
    BINARY_PATH="backend/target/aarch64-unknown-linux-musl/release/simadmin"
    FRONTEND_DIR="frontend/dist"
    
    # 检查构建产物
    if [ ! -f "$BINARY_PATH" ]; then
        echo "跳过 OTA: 后端二进制不存在"
    elif [ ! -d "$FRONTEND_DIR" ]; then
        echo "跳过 OTA: 前端构建产物不存在"
    else
        # 获取 Git commit
        if command -v git &> /dev/null && [ -d ".git" ]; then
            COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
        else
            COMMIT="unknown"
        fi
        
        # 构建时间
        BUILD_TIME=$(TZ=Asia/Shanghai date +"%Y-%m-%dT%H:%M:%S+08:00")
        
        # 目标架构
        ARCH="aarch64-unknown-linux-musl"
        
        # 创建临时目录
        OTA_TMP=$(mktemp -d)
        trap "rm -rf $OTA_TMP" EXIT
        
        echo "版本: $VERSION"
        echo "Commit: $COMMIT"
        echo "构建时间: $BUILD_TIME"
        echo ""
        
        # 复制后端二进制
        echo "复制后端二进制..."
        cp "$BINARY_PATH" "$OTA_TMP/simadmin"
        chmod 755 "$OTA_TMP/simadmin"
        
        # 计算二进制 MD5
        if [[ "$OSTYPE" == "darwin"* ]]; then
            BINARY_MD5=$(md5 -q "$OTA_TMP/simadmin")
        else
            BINARY_MD5=$(md5sum "$OTA_TMP/simadmin" | cut -d' ' -f1)
        fi
        echo "  二进制 MD5: $BINARY_MD5"
        
        # 复制前端文件
        echo "复制前端文件..."
        mkdir -p "$OTA_TMP/www"
        cp -r "$FRONTEND_DIR"/* "$OTA_TMP/www/"
        
        # 计算前端 MD5
        if [[ "$OSTYPE" == "darwin"* ]]; then
            FRONTEND_MD5=$(find "$OTA_TMP/www" -type f -exec md5 -q {} \; | sort | tr '\n' '\n' | md5 -q)
        else
            FRONTEND_MD5=$(find "$OTA_TMP/www" -type f -exec md5sum {} \; | cut -d' ' -f1 | sort | md5sum | cut -d' ' -f1)
        fi
        echo "  前端 MD5: $FRONTEND_MD5"
        
        # 生成 meta.json
        cat > "$OTA_TMP/meta.json" << EOF
{
    "version": "$VERSION",
    "commit": "$COMMIT",
    "build_time": "$BUILD_TIME",
    "binary_md5": "$BINARY_MD5",
    "frontend_md5": "$FRONTEND_MD5",
    "arch": "$ARCH"
}
EOF
        
        # 创建输出目录
        mkdir -p release
        
        # 打包
        OTA_FILE="release/simadmin_${VERSION}.tar.gz"
        echo "打包 OTA..."
        cd "$OTA_TMP"
        tar -czf - meta.json simadmin www > "$OLDPWD/$OTA_FILE"
        cd "$OLDPWD"
        
        # 显示结果
        echo ""
        echo "OTA 更新包生成完成!"
        echo "输出: $OTA_FILE"
        ls -lh "$OTA_FILE"
        
        # 计算包的 MD5
        if [[ "$OSTYPE" == "darwin"* ]]; then
            OTA_MD5=$(md5 -q "$OTA_FILE")
        else
            OTA_MD5=$(md5sum "$OTA_FILE" | cut -d' ' -f1)
        fi
        echo "OTA 包 MD5: $OTA_MD5"
    fi
fi

echo ""
echo "=========================================="
echo "部署命令: ./scripts/deploy.sh"
echo "=========================================="
