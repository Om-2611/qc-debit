import UndoOutlined from '@mui/icons-material/UndoOutlined';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import type { ImportBatchDto } from '@dalmia/types';
import { errorMessage } from '../../api/admin';
import { useImportBatches, useUndoImport } from '../../api/import';
import { formatDateTime } from '../../lib/format';

/** Every upload so far, newest first; an import can be undone within 24 hours of the upload. */
export function PreviousImports() {
  const { data, error } = useImportBatches();
  const undo = useUndoImport();
  const [confirming, setConfirming] = useState<ImportBatchDto | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const runUndo = async () => {
    if (!confirming) return;
    const batch = confirming;
    setConfirming(null);
    setFailure(null);
    try {
      const result = await undo.mutateAsync(batch.id);
      setDone(`Undone: ${result.deletedReports} report(s) from "${batch.fileName}" removed.`);
    } catch (err) {
      setFailure(errorMessage(err));
    }
  };

  return (
    <Box>
      <Typography className="section-label">Previous imports</Typography>
      <Typography variant="h3" sx={{ mb: 1.5 }}>
        Uploads
      </Typography>
      {error && <Alert severity="error">{error.message}</Alert>}
      {failure && (
        <Alert severity="error" onClose={() => setFailure(null)} sx={{ mb: 1.5 }}>
          {failure}
        </Alert>
      )}
      {done && (
        <Alert severity="success" onClose={() => setDone(null)} sx={{ mb: 1.5 }}>
          {done}
        </Alert>
      )}
      <Paper variant="outlined">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>File</TableCell>
                <TableCell>Uploaded</TableCell>
                <TableCell>By</TableCell>
                <TableCell align="right">Sheets</TableCell>
                <TableCell align="right">Imported</TableCell>
                <TableCell align="right">Skipped</TableCell>
                <TableCell align="right">Failed</TableCell>
                <TableCell align="right">Reports now</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>{b.fileName}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(b.uploadedAt)}</TableCell>
                  <TableCell>{b.uploadedBy.name}</TableCell>
                  <TableCell className="num">{b.sheetCount}</TableCell>
                  <TableCell className="num">{b.importedCount}</TableCell>
                  <TableCell className="num">{b.skippedCount}</TableCell>
                  <TableCell className="num">{b.errorCount}</TableCell>
                  <TableCell className="num">{b.reportCount}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {b.undoneAt ? (
                      <Typography variant="caption" color="text.secondary">
                        Undone {formatDateTime(b.undoneAt)}
                      </Typography>
                    ) : b.canUndo ? (
                      <Button size="small" color="error" startIcon={<UndoOutlined />} onClick={() => setConfirming(b)} disabled={undo.isPending}>
                        Undo this import
                      </Button>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        Undo window closed
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {data && data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} sx={{ py: 3, textAlign: 'center', color: 'text.secondary' }}>
                    Nothing has been imported yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={confirming !== null} onClose={() => setConfirming(null)}>
        <DialogTitle>Undo this import?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            All {confirming?.reportCount} report(s) created from “{confirming?.fileName}” will be deleted. This cannot be reversed; the
            file can be imported again afterwards.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirming(null)}>Keep them</Button>
          <Button variant="contained" color="error" onClick={() => void runUndo()}>
            Delete the reports
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
