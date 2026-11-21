static double entries[128];
static int entry_count;

void ledger_add(double amount) {
  if (entry_count < 128) entries[entry_count++] = amount;
}

double ledger_total(void) {
  double total = 0;
  for (int index = 0; index < entry_count; index++) total += entries[index];
  return total;
}
