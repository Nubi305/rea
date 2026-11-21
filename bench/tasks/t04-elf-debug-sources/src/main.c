#include <stdio.h>
#include <stdlib.h>

double tariff_for(double weight_kg, int fragile);
void ledger_add(double amount);
double ledger_total(void);

int main(int argc, char **argv) {
  for (int index = 1; index < argc; index++) ledger_add(tariff_for(strtod(argv[index], NULL), index % 2));
  printf("total %.2f\n", ledger_total());
  return 0;
}
