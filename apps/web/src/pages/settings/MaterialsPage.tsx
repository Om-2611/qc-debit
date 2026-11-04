import { Alert, Box, Button, LinearProgress, Paper, Snackbar, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import type { AdminMaterialDto } from '@dalmia/types';
import { errorMessage, useAdminMaterials, useUpdateMaterial } from '../../api/admin';

/** Admin → Settings → Materials: rename, reorder or switch off a column. The five codes are the sheet's columns and stay fixed. */
export function MaterialsPage() {
  const { data, isFetching, error } = useAdminMaterials();
  const [failure, setFailure] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  return (
    <Stack spacing={2} sx={{ maxWidth: 960 }}>
      <Box>
        <Typography className="section-label">Settings · Materials</Typography>
        <Typography variant="h2">Materials</Typography>
      </Box>

      <Alert severity="info">
        The debit note has exactly these five material columns (sheet columns E, G, I, K, L), and the calculation refers to them by
        code — Clear for the weight-short rate, Barwaste for the premium, Green for the price difference. So materials cannot be
        added or deleted and the code cannot be changed; you can rename a column, change the order, or switch it off for new reports.
      </Alert>
      {(error || failure) && (
        <Alert severity="error" onClose={failure ? () => setFailure(null) : undefined}>
          {failure ?? error?.message}
        </Alert>
      )}

      <Paper variant="outlined">
        <Box sx={{ height: 4 }}>{isFetching && <LinearProgress />}</Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Code (fixed)</TableCell>
                <TableCell>Name</TableCell>
                <TableCell align="right">Sort order</TableCell>
                <TableCell>Active</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.map((m) => (
                <MaterialRow key={m.id} material={m} onFailure={setFailure} onDone={setToast} />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
      <Snackbar open={toast !== null} autoHideDuration={2500} onClose={() => setToast(null)} message={toast} />
    </Stack>
  );
}

function MaterialRow({ material, onFailure, onDone }: { material: AdminMaterialDto; onFailure: (m: string | null) => void; onDone: (m: string) => void }) {
  const update = useUpdateMaterial();
  const [name, setName] = useState(material.name);
  const [sortOrder, setSortOrder] = useState(String(material.sortOrder));

  // Adopt the server copy after a save or refetch.
  useEffect(() => {
    setName(material.name);
    setSortOrder(String(material.sortOrder));
  }, [material]);

  const order = Number(sortOrder);
  const valid = name.trim().length > 0 && sortOrder.trim() !== '' && Number.isInteger(order) && order >= 0;
  const dirty = name.trim() !== material.name || order !== material.sortOrder;

  const save = async (body: { name?: string; sortOrder?: number; isActive?: boolean }, done: string) => {
    onFailure(null);
    try {
      await update.mutateAsync({ id: material.id, body });
      onDone(done);
    } catch (err) {
      onFailure(errorMessage(err));
    }
  };

  return (
    <TableRow sx={{ opacity: material.isActive ? 1 : 0.6 }}>
      <TableCell sx={{ fontFamily: 'var(--font-numeric)', fontSize: '0.8rem' }}>{material.code}</TableCell>
      <TableCell>
        <input className="cell-input text" style={{ width: 240 }} aria-label={`Name of ${material.code}`} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
      </TableCell>
      <TableCell align="right">
        <input
          className="cell-input"
          style={{ width: 72 }}
          inputMode="numeric"
          aria-label={`Sort order of ${material.code}`}
          value={sortOrder}
          onChange={(e) => /^\d{0,5}$/.test(e.target.value) && setSortOrder(e.target.value)}
        />
      </TableCell>
      <TableCell>
        <Switch
          size="small"
          checked={material.isActive}
          disabled={update.isPending}
          onChange={(_e, checked) => void save({ isActive: checked }, `${material.name} ${checked ? 'switched on' : 'switched off'}`)}
          slotProps={{ input: { 'aria-label': `${material.name} active` } }}
        />
      </TableCell>
      <TableCell align="right">
        <Button size="small" variant="outlined" disabled={!dirty || !valid || update.isPending} onClick={() => void save({ name: name.trim(), sortOrder: order }, `${name.trim()} saved`)}>
          Save
        </Button>
      </TableCell>
    </TableRow>
  );
}
