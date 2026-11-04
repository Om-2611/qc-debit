/**
 * GST state codes (first two digits of a GSTIN), used only for the GSTIN-prefix fallback in pre-flight, and compared by code.
 * Never compared with the state names iON shows on screen.
 */
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '25': 'Daman and Diu (legacy)', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra',
  '28': 'Andhra Pradesh (old)', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
};

export interface SupplierState {
  /** null = neither source gave a usable code. */
  code: string | null;
  source: 'ion' | 'gstin' | null;
  /** Both sources gave a code and they differ: the push is blocked until an admin fixes the master. */
  conflict: { ion: string; gstin: string } | null;
}

/** iON's supplier master value wins; the GSTIN's first two digits are the fallback. */
export function resolveSupplierState(supplier: { ionStateCode: string | null; gstin: string | null }): SupplierState {
  const ion = supplier.ionStateCode?.trim() || null;
  const gstin = /^\d{2}/.exec(supplier.gstin?.trim() ?? '')?.[0] ?? null;
  const conflict = ion && gstin && ion !== gstin ? { ion, gstin } : null;
  if (ion) return { code: ion, source: 'ion', conflict };
  if (gstin) return { code: gstin, source: 'gstin', conflict: null };
  return { code: null, source: null, conflict: null };
}
