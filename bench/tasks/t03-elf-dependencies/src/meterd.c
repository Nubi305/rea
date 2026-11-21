#include <math.h>
#include <stdio.h>
#include <stdlib.h>

static int by_value(const void *left, const void *right) {
  double a = *(const double *)left;
  double b = *(const double *)right;
  return (a > b) - (a < b);
}

/* Reads readings from a helper command, sorts them and prints a power sum. */
int main(int argc, char **argv) {
  double readings[64];
  int count = 0;
  const char *command = getenv("METERD_SOURCE");
  FILE *source = popen(command ? command : "cat /dev/null", "r");
  if (source == NULL) return 1;
  char line[64];
  while (count < 64 && fgets(line, sizeof line, source)) readings[count++] = strtod(line, NULL);
  pclose(source);
  qsort(readings, count, sizeof readings[0], by_value);
  double exponent = argc > 1 ? strtod(argv[1], NULL) : 2.0;
  double sum = 0;
  for (int index = 0; index < count; index++) sum += pow(readings[index], exponent);
  printf("%d readings, power sum %.3f\n", count, sum);
  return 0;
}
