import { useEffect, useState, type MouseEvent, type SyntheticEvent } from 'react'
import {
  Box,
  Typography,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Switch,
  FormControlLabel,
  Button,
  Divider,
  Alert,
  CircularProgress,
  Chip,
  Snackbar,
  Card,
  CardContent,
  CardHeader,
  LinearProgress,
} from '@mui/material'
import Grid from '@mui/material/Grid'
import {
  ExpandMore,
  Wifi,
  CheckCircle,
  Error as ErrorIcon,
  HealthAndSafety,
  FlightTakeoff,
} from '@mui/icons-material'
import { api } from '../api/current'
import ErrorSnackbar from '../components/ErrorSnackbar'
import type { AirplaneModeResponse } from '../api/types'

interface HealthStatus {
  status: string
  timestamp?: string
}

const configAccordionSx = {
  borderRadius: '12px',
  overflow: 'hidden',
  border: 1,
  borderColor: 'divider',
  boxShadow: '0 10px 30px -22px rgba(15, 23, 42, 0.45)',
  '&:before': { display: 'none' },
  '&.MuiAccordion-root': {
    borderRadius: '12px',
  },
  '&.MuiAccordion-root:first-of-type, &.MuiAccordion-root:last-of-type': {
    borderRadius: '12px',
  },
  '&.Mui-expanded': {
    m: 0,
    borderRadius: '12px',
  },
  '& .MuiAccordionSummary-root': {
    borderRadius: '12px',
  },
  '& .MuiAccordionSummary-root.Mui-expanded': {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
} as const

export default function ConfigurationPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [dataConnectionExpanded, setDataConnectionExpanded] = useState(true)
  const [airplaneModeExpanded, setAirplaneModeExpanded] = useState(false)
  
  const [dataStatus, setDataStatus] = useState(false)
  
  // 飞行模式状态
  const [airplaneMode, setAirplaneMode] = useState<AirplaneModeResponse | null>(null)
  const [airplaneSwitching, setAirplaneSwitching] = useState(false)
  
  // 健康检查状态
  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)

  const loadData = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const [dataRes, airplaneModeRes] = await Promise.all([
        api.getDataStatus(),
        api.getAirplaneMode(),
      ])
      
      if (dataRes.data) setDataStatus(dataRes.data.active)
      if (airplaneModeRes.data) setAirplaneMode(airplaneModeRes.data)

      // 加载健康检查
      await checkHealth()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  // 健康检查
  const checkHealth = async () => {
    setHealthLoading(true)
    try {
      const response = await api.health()
      setHealthStatus({
        status: response.status,
        timestamp: new Date().toISOString(),
      })
    } catch {
      setHealthStatus({
        status: 'error',
        timestamp: new Date().toISOString(),
      })
    } finally {
      setHealthLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
    // 每30秒自动检查健康状态
    const interval = setInterval(() => {
      void checkHealth()
    }, 30000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDataConnectionAccordionChange = (_event: SyntheticEvent, isExpanded: boolean) => {
    setDataConnectionExpanded(isExpanded)
  }

  const handleAirplaneModeAccordionChange = (_event: SyntheticEvent, isExpanded: boolean) => {
    setAirplaneModeExpanded(isExpanded)
  }

  const handleDataToggle = () => {
    void toggleDataConnection()
  }

  const toggleDataConnection = async () => {
    try {
      setError(null)
      setSuccess(null)
      const newStatus = !dataStatus
      await api.setDataStatus(newStatus)
      setDataStatus(newStatus)
      setSuccess(`数据连接已${newStatus ? '启用' : '禁用'}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const toggleAirplaneMode = async () => {
    const snapshot = airplaneMode
    const newEnabled = !snapshot?.enabled
    if (snapshot) {
      setAirplaneMode({ ...snapshot, enabled: newEnabled })
    }
    try {
      setError(null)
      setSuccess(null)
      setAirplaneSwitching(true)
      const response = await api.setAirplaneMode(newEnabled)
      if (response.data) {
        setAirplaneMode(response.data)
        const actuallyOn = response.data.enabled
        setSuccess(`飞行模式已${actuallyOn ? '开启' : '关闭'}`)
      }
    } catch (err) {
      if (snapshot) setAirplaneMode(snapshot)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAirplaneSwitching(false)
    }
  }

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box>
      {/* 页面标题 */}
      <Box mb={3}>
        <Typography variant="h4" gutterBottom fontWeight={600}>
          系统配置
        </Typography>
        <Typography variant="body2" color="text.secondary">
          管理设备连接和其他系统参数
        </Typography>
      </Box>

      {/* 错误和成功提示 Snackbar */}
      <ErrorSnackbar error={error} onClose={() => setError(null)} />
      {success && (
        <Snackbar
          open={true}
          autoHideDuration={3000}
          resumeHideDuration={3000}
          onClose={() => setSuccess(null)}
          anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        >
          <Alert severity="success" variant="filled" onClose={() => setSuccess(null)}>
            {success}
          </Alert>
        </Snackbar>
      )}

      {/* 健康检查状态卡片 */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12 }}>
          <Card>
            <CardHeader
              avatar={<HealthAndSafety color="primary" />}
              title="系统健康检查"
              titleTypographyProps={{ variant: 'h6', fontWeight: 600 }}
              action={
                <Button
                  size="small"
                  onClick={() => void checkHealth()}
                  disabled={healthLoading}
                  startIcon={healthLoading ? <CircularProgress size={16} /> : undefined}
                >
                  刷新
                </Button>
              }
            />
            <CardContent>
              {healthLoading && !healthStatus ? (
                <LinearProgress />
              ) : (
                <Box display="flex" alignItems="center" gap={2}>
                  {healthStatus?.status === 'ok' ? (
                    <CheckCircle sx={{ fontSize: 48, color: 'success.main' }} />
                  ) : (
                    <ErrorIcon sx={{ fontSize: 48, color: 'error.main' }} />
                  )}
                  <Box>
                    <Typography variant="h6" fontWeight={600}>
                      {healthStatus?.status === 'ok' ? '系统正常' : '系统异常'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      后端服务: <Chip
                        label={healthStatus?.status === 'ok' ? '运行中' : '异常'}
                        size="small"
                        color={healthStatus?.status === 'ok' ? 'success' : 'error'}
                      />
                    </Typography>
                    {healthStatus?.timestamp && (
                      <Typography variant="caption" color="text.secondary">
                        上次检查: {new Date(healthStatus.timestamp).toLocaleTimeString()}
                      </Typography>
                    )}
                  </Box>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>


      </Grid>

      {/* 配置面板 */}
      <Box display="flex" flexDirection="column" gap={3}>
        {/* 数据连接配置 */}
        <Accordion
          expanded={dataConnectionExpanded}
          onChange={handleDataConnectionAccordionChange}
          sx={configAccordionSx}
        >
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Box display="flex" alignItems="center" gap={1} width="100%">
              <Wifi color="primary" />
              <Typography fontWeight={600}>数据连接配置</Typography>
              <Box flexGrow={1} />
              <Chip
                label={dataStatus ? '已启用' : '已禁用'}
                color={dataStatus ? 'success' : 'default'}
                size="small"
                onClick={(e: MouseEvent) => e.stopPropagation()}
              />
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Typography variant="body2" color="text.secondary" paragraph>
              控制设备的数据连接状态。禁用后设备将断开移动网络连接。
            </Typography>
            
            <Divider sx={{ my: 2 }} />
            
            <FormControlLabel
              control={
                <Switch
                  checked={dataStatus}
                  onChange={handleDataToggle}
                  color="primary"
                />
              }
              label={
                <Box>
                  <Typography variant="body1" fontWeight={600}>
                    {dataStatus ? '数据连接已启用' : '数据连接已禁用'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    立即{dataStatus ? '断开' : '启用'}移动数据连接
                  </Typography>
                </Box>
              }
            />

            <Alert severity="info" sx={{ mt: 2 }}>
              提示：禁用数据连接将中断所有使用移动网络的应用和服务
            </Alert>
          </AccordionDetails>
        </Accordion>

        {/* 飞行模式配置 */}
        <Accordion
          expanded={airplaneModeExpanded}
          onChange={handleAirplaneModeAccordionChange}
          sx={configAccordionSx}
        >
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Box display="flex" alignItems="center" gap={1} width="100%">
              <FlightTakeoff color={airplaneMode?.enabled ? 'warning' : 'primary'} />
              <Typography fontWeight={600}>飞行模式</Typography>
              <Box flexGrow={1} />
              <Chip
                label={airplaneMode?.enabled ? '已开启' : '已关闭'}
                color={airplaneMode?.enabled ? 'warning' : 'default'}
                size="small"
                onClick={(e: MouseEvent) => e.stopPropagation()}
              />
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Typography variant="body2" color="text.secondary" paragraph>
              开启飞行模式将关闭射频，设备将无法连接移动网络。这不会影响本机 Web 管理访问。
            </Typography>
            
            <Divider sx={{ my: 2 }} />
            
            <FormControlLabel
              control={
                <Switch
                  checked={airplaneMode?.enabled || false}
                  onChange={() => {
                    void toggleAirplaneMode()
                  }}
                  disabled={airplaneSwitching}
                  color="warning"
                />
              }
              label={
                <Box display="flex" alignItems="center" gap={1}>
                  {airplaneSwitching && <CircularProgress size={16} />}
                  <Box>
                    <Typography variant="body1" fontWeight={600}>
                      {airplaneMode?.enabled ? '飞行模式已开启' : '飞行模式已关闭'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {airplaneMode?.enabled ? '射频已关闭，无法连接网络' : '射频正常工作'}
                    </Typography>
                  </Box>
                </Box>
              }
            />

            <Box mt={2} p={2} sx={{ bgcolor: 'action.hover', borderRadius: 1 }}>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                <strong>当前状态详情</strong>
              </Typography>
              <Box display="flex" gap={2} flexWrap="wrap">
                <Chip 
                  label={`Modem 电源: ${airplaneMode?.powered ? '开启' : '关闭'}`}
                  size="small"
                  color={airplaneMode?.powered ? 'success' : 'default'}
                  variant="outlined"
                />
                <Chip 
                  label={`射频: ${airplaneMode?.online ? '在线' : '离线'}`}
                  size="small"
                  color={airplaneMode?.online ? 'success' : 'error'}
                  variant="outlined"
                />
              </Box>
            </Box>

            <Alert severity="warning" sx={{ mt: 2 }}>
              注意：飞行模式通过设置 Modem 的 Online 属性来控制射频，与手机的飞行模式效果相同。
            </Alert>
          </AccordionDetails>
        </Accordion>
      </Box>
    </Box>
  )
}
