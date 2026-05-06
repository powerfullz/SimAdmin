import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent, type SyntheticEvent } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  IconButton,
  Snackbar,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import {
  Add,
  ExpandMore,
  NotificationsActive,
  PlayArrow,
  Webhook,
} from '@mui/icons-material'
import { api } from '../api/current'
import ErrorSnackbar from '../components/ErrorSnackbar'
import type { WebhookConfig } from '../api/types'
import { DEFAULT_CALL_TEMPLATE, DEFAULT_SMS_TEMPLATE } from '../api/types'

const notificationAccordionSx = {
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

const LEGACY_MOJIBAKE_SMS_TEMPLATE = '{\n'
  + '  "msg_type": "text",\n'
  + '  "content": {\n'
  + '    "text": "\u9983\u646b \u942d\ue15d\u4fca\u95ab\u6c31\u7161\\\\n\u9359\u6226\u20ac\u4f79\u67df: {{phone_number}}\\\\n\u9350\u546d\ue190: {{content}}\\\\n\u93c3\u5815\u68ff: {{timestamp}}"\n'
  + '  }\n'
  + '}'

const LEGACY_MOJIBAKE_CALL_TEMPLATE = '{\n'
  + '  "msg_type": "text",\n'
  + '  "content": {\n'
  + '    "text": "\u9983\u6453 \u93c9\u30e7\u6578\u95ab\u6c31\u7161\\\\n\u9359\u98ce\u721c: {{phone_number}}\\\\n\u7eeb\u8bf2\u7037: {{direction}}\\\\n\u93c3\u5815\u68ff: {{start_time}}\\\\n\u93c3\u5815\u66b1: {{duration}}\u7ec9\u6283\\\\n\u5bb8\u53c9\u5e34\u935a? {{answered}}"\n'
  + '  }\n'
  + '}'

const SMS_TEMPLATE_VARIABLES = [
  { label: '发送方号码', displayToken: '{{发送方号码}}', backendToken: '{{phone_number}}' },
  { label: '短信内容', displayToken: '{{短信内容}}', backendToken: '{{content}}' },
  { label: '时间', displayToken: '{{时间}}', backendToken: '{{timestamp}}' },
  { label: '短信方向', displayToken: '{{短信方向}}', backendToken: '{{direction}}' },
  { label: '短信状态', displayToken: '{{短信状态}}', backendToken: '{{status}}' },
] as const

const _CALL_TEMPLATE_VARIABLES = [
  { label: '来电号码', displayToken: '{{来电号码}}', backendToken: '{{phone_number}}' },
  { label: '通话时长', displayToken: '{{通话时长}}', backendToken: '{{duration}}' },
  { label: '开始时间', displayToken: '{{开始时间}}', backendToken: '{{start_time}}' },
  { label: '结束时间', displayToken: '{{结束时间}}', backendToken: '{{end_time}}' },
  { label: '是否接听', displayToken: '{{是否接听}}', backendToken: '{{answered}}' },
  { label: '通话方向', displayToken: '{{通话方向}}', backendToken: '{{direction}}' },
] as const

function replaceAll(input: string, search: string, replacement: string) {
  return input.split(search).join(replacement)
}

function toDisplayTemplate(template: string, variables: readonly { displayToken: string; backendToken: string }[]) {
  return variables.reduce(
    (result, variable) => replaceAll(result, variable.backendToken, variable.displayToken),
    template,
  )
}

function toBackendTemplate(template: string, variables: readonly { displayToken: string; backendToken: string }[]) {
  return variables.reduce(
    (result, variable) => replaceAll(result, variable.displayToken, variable.backendToken),
    template,
  )
}

const DEFAULT_SMS_DISPLAY_TEMPLATE = toDisplayTemplate(DEFAULT_SMS_TEMPLATE, SMS_TEMPLATE_VARIABLES)
const DEFAULT_CALL_DISPLAY_TEMPLATE = toDisplayTemplate(DEFAULT_CALL_TEMPLATE, _CALL_TEMPLATE_VARIABLES)

function normalizeWebhookConfig(config: WebhookConfig): WebhookConfig {
  const smsTemplate = config.sms_template === LEGACY_MOJIBAKE_SMS_TEMPLATE
    ? DEFAULT_SMS_TEMPLATE
    : config.sms_template
  const callTemplate = config.call_template === LEGACY_MOJIBAKE_CALL_TEMPLATE
    ? DEFAULT_CALL_TEMPLATE
    : config.call_template

  return {
    ...config,
    sms_template: toDisplayTemplate(smsTemplate, SMS_TEMPLATE_VARIABLES),
    call_template: toDisplayTemplate(callTemplate, _CALL_TEMPLATE_VARIABLES),
  }
}

function getBackendWebhookConfig(config: WebhookConfig): WebhookConfig {
  return {
    ...config,
    sms_template: toBackendTemplate(config.sms_template, SMS_TEMPLATE_VARIABLES),
    call_template: toBackendTemplate(config.call_template, _CALL_TEMPLATE_VARIABLES),
  }
}

export default function NotificationCenterPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | false>(false)
  const [webhookConfig, setWebhookConfig] = useState<WebhookConfig>({
    enabled: false,
    url: '',
    forward_sms: true,
    forward_calls: true,
    headers: {},
    secret: '',
    sms_template: DEFAULT_SMS_DISPLAY_TEMPLATE,
    call_template: DEFAULT_CALL_DISPLAY_TEMPLATE,
  })
  const [webhookLoading, setWebhookLoading] = useState(false)
  const [webhookTesting, setWebhookTesting] = useState(false)
  const [newHeaderKey, setNewHeaderKey] = useState('')
  const [newHeaderValue, setNewHeaderValue] = useState('')
  const smsTemplateInputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const loadWebhookConfig = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await api.getWebhookConfig()
        if (response.data) setWebhookConfig(normalizeWebhookConfig(response.data))
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    }

    void loadWebhookConfig()
  }, [])

  const handleAccordionChange = (panel: string) => (_event: SyntheticEvent, isExpanded: boolean) => {
    setExpanded(isExpanded ? panel : false)
  }

  const handleWebhookEnabledChange = (event: ChangeEvent<HTMLInputElement>) => {
    const enabled = event.target.checked
    setWebhookConfig({ ...webhookConfig, enabled })
    setExpanded(enabled ? 'webhook' : false)
  }

  const handleSaveWebhook = async () => {
    setWebhookLoading(true)
    setError(null)
    try {
      const response = await api.setWebhookConfig(getBackendWebhookConfig(webhookConfig))
      if (response.status === 'ok') {
        setSuccess('Webhook 配置已保存')
      } else {
        setError(response.message)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setWebhookLoading(false)
    }
  }

  const handleTestWebhook = async () => {
    setWebhookTesting(true)
    setError(null)
    try {
      const response = await api.testWebhook()
      if (response.status === 'ok' && response.data) {
        if (response.data.success) {
          setSuccess(response.data.message)
        } else {
          setError(response.data.message)
        }
      } else {
        setError(response.message)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setWebhookTesting(false)
    }
  }

  const handleAddHeader = () => {
    if (newHeaderKey.trim() && newHeaderValue.trim()) {
      setWebhookConfig({
        ...webhookConfig,
        headers: {
          ...webhookConfig.headers,
          [newHeaderKey.trim()]: newHeaderValue.trim(),
        },
      })
      setNewHeaderKey('')
      setNewHeaderValue('')
    }
  }

  const handleRemoveHeader = (key: string) => {
    const newHeaders = { ...webhookConfig.headers }
    delete newHeaders[key]
    setWebhookConfig({
      ...webhookConfig,
      headers: newHeaders,
    })
  }

  const handleInsertSmsVariable = (displayToken: string) => {
    const input = smsTemplateInputRef.current
    const template = webhookConfig.sms_template
    const selectionStart = input?.selectionStart ?? template.length
    const selectionEnd = input?.selectionEnd ?? template.length
    const nextTemplate = `${template.slice(0, selectionStart)}${displayToken}${template.slice(selectionEnd)}`
    setWebhookConfig({
      ...webhookConfig,
      sms_template: nextTemplate,
    })

    window.requestAnimationFrame(() => {
      input?.focus()
      const nextCursor = selectionStart + displayToken.length
      input?.setSelectionRange(nextCursor, nextCursor)
    })
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
      <Box mb={3}>
        <Box display="flex" alignItems="center" gap={1} mb={1}>
          <NotificationsActive color="primary" />
          <Typography variant="h4" fontWeight={600}>
            通知中心
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary">
          管理短信、来电和系统事件的外部通知转发
        </Typography>
      </Box>

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

      <Accordion
        expanded={expanded === 'webhook'}
        onChange={handleAccordionChange('webhook')}
        sx={notificationAccordionSx}
      >
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Box display="flex" alignItems="center" gap={1} width="100%">
            <Webhook color={webhookConfig.enabled ? 'success' : 'primary'} />
            <Typography fontWeight={600}>Webhook 转发</Typography>
            <Chip
              label={webhookConfig.enabled ? '已启用' : '已禁用'}
              color={webhookConfig.enabled ? 'success' : 'default'}
              size="small"
              onClick={(e: MouseEvent) => e.stopPropagation()}
            />
            <Box flexGrow={1} />
            <Switch
              checked={webhookConfig.enabled}
              onChange={handleWebhookEnabledChange}
              onClick={(e: MouseEvent) => e.stopPropagation()}
              color="success"
              inputProps={{ 'aria-label': '启用 Webhook 转发' }}
            />
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="body2" color="text.secondary" paragraph>
            启用后，短信将自动转发到指定的 Webhook URL。适用于消息推送、自动化处理等场景。
          </Typography>

          <Divider sx={{ my: 2 }} />

          <TextField
            fullWidth
            label="Webhook URL"
            value={webhookConfig.url}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setWebhookConfig({ ...webhookConfig, url: e.target.value })}
            placeholder="https://example.com/webhook"
            sx={{ mb: 2 }}
            disabled={!webhookConfig.enabled}
          />

          <Box display="flex" gap={2} mb={2} flexWrap="wrap">
            <FormControlLabel
              control={
                <Switch
                  checked={webhookConfig.forward_sms}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setWebhookConfig({ ...webhookConfig, forward_sms: e.target.checked })}
                  disabled={!webhookConfig.enabled}
                />
              }
              label="转发短信"
            />
            {/*
              TODO: 电话转发暂未实现。
            <FormControlLabel
              control={
                <Switch
                  checked={webhookConfig.forward_calls}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setWebhookConfig({ ...webhookConfig, forward_calls: e.target.checked })}
                  disabled={!webhookConfig.enabled}
                />
              }
              label="转发来电"
            />
            */}
          </Box>

          <TextField
            fullWidth
            label="签名密钥 (可选)"
            value={webhookConfig.secret}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setWebhookConfig({ ...webhookConfig, secret: e.target.value })}
            placeholder="用于验证 Webhook 请求的密钥"
            type="password"
            sx={{ mb: 2 }}
            disabled={!webhookConfig.enabled}
            helperText="设置后将在请求头添加 X-Webhook-Signature"
          />

          <Typography variant="subtitle2" gutterBottom>自定义请求头</Typography>
          <Box display="flex" gap={1} mb={1} flexWrap={{ xs: 'wrap', sm: 'nowrap' }}>
            <TextField
              size="small"
              label="Header Key"
              value={newHeaderKey}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNewHeaderKey(e.target.value)}
              disabled={!webhookConfig.enabled}
              sx={{ flex: '1 1 180px' }}
            />
            <TextField
              size="small"
              label="Header Value"
              value={newHeaderValue}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNewHeaderValue(e.target.value)}
              disabled={!webhookConfig.enabled}
              sx={{ flex: '1 1 180px' }}
            />
            <IconButton
              color="primary"
              onClick={handleAddHeader}
              disabled={!webhookConfig.enabled || !newHeaderKey.trim() || !newHeaderValue.trim()}
            >
              <Add />
            </IconButton>
          </Box>
          {Object.keys(webhookConfig.headers).length > 0 && (
            <Box mb={2}>
              {Object.entries(webhookConfig.headers).map(([key, value]) => (
                <Chip
                  key={key}
                  label={`${key}: ${value}`}
                  onDelete={() => handleRemoveHeader(key)}
                  size="small"
                  sx={{ mr: 1, mb: 1 }}
                  disabled={!webhookConfig.enabled}
                />
              ))}
            </Box>
          )}

          <Divider sx={{ my: 2 }} />

          <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            Payload 模板
            <Chip label="JSON" size="small" variant="outlined" />
          </Typography>

          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="body2" fontWeight={600} gutterBottom>
              支持的模板变量：
            </Typography>
            <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
              <Typography variant="body2">
                短信:
              </Typography>
              {SMS_TEMPLATE_VARIABLES.map((variable) => (
                <Chip
                  key={variable.displayToken}
                  label={`+ ${variable.label}`}
                  size="small"
                  variant="outlined"
                  clickable
                  disabled={!webhookConfig.enabled}
                  onClick={() => handleInsertSmsVariable(variable.displayToken)}
                  sx={{
                    color: 'inherit',
                    borderColor: 'currentColor',
                    '&:hover': {
                      borderColor: 'currentColor',
                    },
                  }}
                />
              ))}
            </Box>
            {/*
              TODO: 电话转发暂未实现。
            <Box display="flex" gap={1} flexWrap="wrap" mt={1}>
              {_CALL_TEMPLATE_VARIABLES.map((variable) => (
                <Chip
                  key={variable.displayToken}
                  label={`+ ${variable.label}`}
                  size="small"
                  variant="outlined"
                />
              ))}
            </Box>
            */}
          </Alert>

          <TextField
            fullWidth
            label="短信通知模板"
            inputRef={smsTemplateInputRef}
            value={webhookConfig.sms_template}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setWebhookConfig({ ...webhookConfig, sms_template: e.target.value })}
            multiline
            rows={6}
            sx={{ mb: 2, fontFamily: 'monospace' }}
            disabled={!webhookConfig.enabled}
            placeholder={DEFAULT_SMS_DISPLAY_TEMPLATE}
            InputProps={{
              sx: { fontFamily: 'monospace', fontSize: '0.85rem' },
            }}
          />

          {/*
            TODO: 电话转发暂未实现。
          <TextField
            fullWidth
            label="通话通知模板"
            value={webhookConfig.call_template}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setWebhookConfig({ ...webhookConfig, call_template: e.target.value })}
            multiline
            rows={6}
            sx={{ mb: 2 }}
            disabled={!webhookConfig.enabled}
            placeholder={DEFAULT_CALL_DISPLAY_TEMPLATE}
            InputProps={{
              sx: { fontFamily: 'monospace', fontSize: '0.85rem' },
            }}
          />
          */}

          <Box display="flex" gap={1} mb={2}>
            <Button
              size="small"
              variant="outlined"
              onClick={() => setWebhookConfig({
                ...webhookConfig,
                sms_template: DEFAULT_SMS_DISPLAY_TEMPLATE,
                // TODO: 电话转发暂未实现。
                // call_template: DEFAULT_CALL_DISPLAY_TEMPLATE,
              })}
              disabled={!webhookConfig.enabled}
            >
              重置为默认模板
            </Button>
          </Box>

          <Divider sx={{ my: 2 }} />

          <Box display="flex" gap={2} alignItems="center">
            <Button
              variant="contained"
              fullWidth
              onClick={() => void handleSaveWebhook()}
              disabled={webhookLoading}
              startIcon={webhookLoading ? <CircularProgress size={20} /> : undefined}
              sx={{ height: 36 }}
            >
              {webhookLoading ? '保存中...' : '保存配置'}
            </Button>
            <Button
              variant="outlined"
              onClick={() => void handleTestWebhook()}
              disabled={webhookTesting || !webhookConfig.enabled || !webhookConfig.url}
              startIcon={webhookTesting ? <CircularProgress size={20} /> : <PlayArrow />}
              sx={{ height: 36, minWidth: 104, flexShrink: 0, whiteSpace: 'nowrap' }}
            >
              {webhookTesting ? '测试中...' : '测试'}
            </Button>
          </Box>

          <Alert severity="success" sx={{ mt: 2 }}>
            <Typography variant="body2">
              <strong>提示</strong><br/>
              点击“测试”按钮会使用短信模板发送一条模拟消息到 Webhook URL，可用于验证配置是否正确。
            </Typography>
          </Alert>
        </AccordionDetails>
      </Accordion>
    </Box>
  )
}
