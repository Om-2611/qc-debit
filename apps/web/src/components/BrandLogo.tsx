import { Box, Typography } from '@mui/material';
import { useState } from 'react';

// dpipl_new_logo.png is 2400×800 with generous padding; the artwork occupies this box (see brand.md).
const ART = { x: 169, y: 226, width: 2061, height: 347, fileHeight: 800 };

/**
 * Official logo (needs the client's written OK before shipping — see theme/brand.md). Falls back
 * to a text wordmark if the file is removed. The artwork is dark-on-transparent, so always place
 * it on a light surface.
 */
export function BrandLogo({ height = 32 }: { height?: number }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <Typography component="span" sx={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: height * 0.7 }}>
        Dalmia{' '}
        <Box component="span" sx={{ fontWeight: 400 }}>
          Polypro
        </Box>
      </Typography>
    );
  }

  const scale = height / ART.height;
  return (
    <Box
      role="img"
      aria-label="Dalmia Polypro"
      sx={{ position: 'relative', overflow: 'hidden', height, width: ART.width * scale, flexShrink: 0 }}
    >
      <Box
        component="img"
        src="/brand/dpipl_new_logo.png"
        alt=""
        onError={() => setFailed(true)}
        sx={{
          position: 'absolute',
          height: ART.fileHeight * scale,
          maxWidth: 'none',
          left: -ART.x * scale,
          top: -ART.y * scale,
        }}
      />
    </Box>
  );
}
