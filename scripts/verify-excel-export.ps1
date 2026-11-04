# Opens exported workbooks in real Excel, forces a full recalculation and prints Excel's own values
# as JSON, so they can be compared with the figures the app cached in the file.
#
#   pnpm --filter @dalmia/api test            # writes apps/api/tmp/export-*.xlsx
#   powershell -File scripts/verify-excel-export.ps1 | node scripts/compare-excel-export.mjs
#
# Needs Microsoft Excel on this machine; it is a manual check, not part of the automated tests.
param([string]$Dir = (Join-Path $PSScriptRoot '..\apps\api\tmp'))

$cells = @('M15', 'M18', 'M19', 'M21', 'K24')
foreach ($r in 26..30 + 33..39) { foreach ($c in 'K', 'L', 'O', 'P', 'Q', 'R', 'S', 'U') { $cells += "$c$r" } }
foreach ($r in 31, 40, 41) { foreach ($c in 'P', 'Q', 'R', 'S', 'U') { $cells += "$c$r" } }
foreach ($r in 43..47) { foreach ($c in 'O', 'P', 'Q', 'R', 'S') { $cells += "$c$r" } }
$cells += 'Q48', 'S48', 'Q49', 'S49', 'U49', 'K50'

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$result = @{}
try {
  foreach ($file in Get-ChildItem -Path $Dir -Filter 'export-*.xlsx') {
    $wb = $excel.Workbooks.Open($file.FullName, 0, $true)
    $excel.CalculateFullRebuild()
    $ws = $wb.Worksheets.Item('Format')
    $values = @{}
    foreach ($address in $cells) {
      $v = $ws.Range($address).Value2
      if ($ws.Range($address).Text -like '#*') { $values[$address] = $ws.Range($address).Text }
      elseif ($v -is [double] -or $v -is [int]) { $values[$address] = [double]$v }
      elseif ($null -ne $v -and "$v" -ne '') { $values[$address] = "$v" }
    }
    $result[$file.Name] = $values
    $wb.Close($false)
  }
}
finally {
  $excel.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
}
$result | ConvertTo-Json -Depth 4 -Compress
