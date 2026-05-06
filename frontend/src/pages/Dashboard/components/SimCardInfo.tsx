import { useState } from 'react'
import { Box, Card, CardContent, Typography, Stack, Chip, IconButton, Tooltip } from '@mui/material'
import { SimCard, Visibility, VisibilityOff } from '@mui/icons-material'
import { getSensitiveStyle } from '../utils'
import type { SimInfo } from '@/api/types'

interface SimCardInfoProps {
  simInfo: SimInfo | null
}

export function SimCardInfo({ simInfo }: SimCardInfoProps) {
  const [showInfo, setShowInfo] = useState(false)
  const valueTextSx = { fontSize: '0.75rem', textAlign: 'right' } as const

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Box display="flex" alignItems="center" gap={1} mb={2}>
          <SimCard color="primary" />
          <Typography variant="subtitle1" fontWeight={700}>SIM 卡信息</Typography>
          <Chip
            label={simInfo?.present ? '已插入' : '未插入'}
            color={simInfo?.present ? 'success' : 'error'}
            size="small"
            variant="outlined"
            sx={{ ml: 'auto' }}
          />
          <Tooltip title={showInfo ? '隐藏敏感信息' : '显示完整信息'}>
            <IconButton size="small" onClick={() => setShowInfo(!showInfo)}>
              {showInfo ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Box>

        <Stack spacing={1.5}>
          <Box display="flex" justifyContent="space-between" alignItems="center" gap={2}>
            <Typography variant="caption" color="text.secondary">ICCID</Typography>
            <Typography variant="body2" sx={{ ...valueTextSx, ...getSensitiveStyle(showInfo) }}>
              {simInfo?.iccid || 'N/A'}
            </Typography>
          </Box>

          <Box display="flex" justifyContent="space-between" alignItems="center" gap={2}>
            <Typography variant="caption" color="text.secondary">手机号</Typography>
            <Typography variant="body2" sx={{ ...valueTextSx, ...getSensitiveStyle(showInfo) }}>
              {simInfo?.phone_numbers?.length ? simInfo.phone_numbers[0] : 'N/A'}
            </Typography>
          </Box>

          <Box display="flex" justifyContent="space-between" alignItems="center" gap={2}>
            <Typography variant="caption" color="text.secondary">MCC/MNC</Typography>
            <Typography variant="body2" sx={valueTextSx}>
              {simInfo?.mcc || '?'}/{simInfo?.mnc || '?'}
            </Typography>
          </Box>

          <Box display="flex" justifyContent="space-between" alignItems="center" gap={2}>
            <Typography variant="caption" color="text.secondary">短信中心</Typography>
            <Typography variant="body2" sx={{ ...valueTextSx, ...getSensitiveStyle(showInfo) }}>
              {simInfo?.sms_center || 'N/A'}
            </Typography>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  )
}
