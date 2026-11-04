import { Box, Button, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { BrandLogo } from '../../components/BrandLogo';
import { CHART_SERIES, COLOR_TOKENS, OTHER_TOKENS } from '../../theme/tokens';

/** Admin → Settings → Appearance: lets the client confirm the sampled colours and fonts against their website. */
export function BrandTokensPage() {
  return (
    <Stack spacing={3} sx={{ maxWidth: 960 }}>
      <Box>
        <Typography className="section-label">Settings · Appearance</Typography>
        <Typography variant="h2">Brand tokens</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Sampled from dalmiapolypro.in on 21-09-2026. Please confirm these match the website; the fonts are open-licence
          substitutes because the site’s Avenir cannot be self-hosted.
        </Typography>
      </Box>

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography className="section-label" sx={{ mb: 1.5 }}>
          Logo
        </Typography>
        <BrandLogo height={40} />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          Written approval from Dalmia Polypro is required before this logo ships. Without it the app shows the text
          wordmark “Dalmia Polypro”.
        </Typography>
      </Paper>

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 56 }} />
              <TableCell>Token</TableCell>
              <TableCell>Value</TableCell>
              <TableCell>Source / use</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {Object.entries(COLOR_TOKENS).map(([name, meta]) => (
              <TableRow key={name}>
                <TableCell>
                  <Box
                    sx={{
                      width: 32,
                      height: 32,
                      bgcolor: meta.value,
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-surface)',
                    }}
                  />
                </TableCell>
                <TableCell sx={{ fontFamily: 'var(--font-numeric)', fontSize: '0.8rem' }}>{name}</TableCell>
                <TableCell sx={{ fontFamily: 'var(--font-numeric)', fontSize: '0.8rem' }}>{meta.value}</TableCell>
                <TableCell>{meta.source}</TableCell>
              </TableRow>
            ))}
            {Object.entries(OTHER_TOKENS).map(([name, meta]) => (
              <TableRow key={name}>
                <TableCell>
                  {name === '--brand-gradient' && (
                    <Box sx={{ width: 32, height: 32, background: meta.value, borderRadius: 'var(--radius-surface)' }} />
                  )}
                </TableCell>
                <TableCell sx={{ fontFamily: 'var(--font-numeric)', fontSize: '0.8rem' }}>{name}</TableCell>
                <TableCell sx={{ fontFamily: 'var(--font-numeric)', fontSize: '0.8rem', maxWidth: 280 }}>
                  {meta.value}
                </TableCell>
                <TableCell>{meta.source}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography className="section-label" sx={{ mb: 1.5 }}>
          Typography
        </Typography>
        <Typography className="section-label">A) Discretionary</Typography>
        <Typography variant="h3" sx={{ mb: 1 }}>
          Section title in the heading font
        </Typography>
        <Typography sx={{ mb: 1 }}>Body text: moisture above the seasonal norm raises a standard deduction.</Typography>
        <Typography className="num" sx={{ textAlign: 'left' }}>
          ₹ 33,545.40 · 279.55 kg · 7.45 %
        </Typography>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography className="section-label" sx={{ mb: 1.5 }}>
          Buttons and chart series
        </Typography>
        <Stack direction="row" spacing={1.5} sx={{ mb: 2, flexWrap: 'wrap' }}>
          <Button variant="contained">Primary</Button>
          <Button variant="outlined">Secondary</Button>
          <Button variant="contained" color="error">
            Destructive
          </Button>
        </Stack>
        <Stack direction="row" spacing={0.5}>
          {CHART_SERIES.map((c) => (
            <Box key={c} title={c} sx={{ width: 48, height: 24, bgcolor: c }} />
          ))}
        </Stack>
      </Paper>
    </Stack>
  );
}
