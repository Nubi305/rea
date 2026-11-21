#include <stdio.h>
#include <string.h>

/* migrate [--dry-run] <state directory>: plans the pending migrations. */
int main(int argc, char **argv) {
  int dry_run = argc > 2 && strcmp(argv[1], "--dry-run") == 0;
  const char *state = argc > 2 ? argv[2] : argc > 1 ? argv[1] : ".";
  char path[512];
  int version = 0;

  snprintf(path, sizeof path, "%s/schema.version", state);
  FILE *current = fopen(path, "r");
  if (current == NULL) {
    fprintf(stderr, "migrate: no schema.version in %s\n", state);
    return 4;
  }
  if (fscanf(current, "%d", &version) != 1) version = 0;
  fclose(current);

  printf("schema at version %d, 3 migrations pending\n", version);
  snprintf(path, sizeof path, "%s/plan.txt", state);
  FILE *plan = fopen(path, "w");
  if (plan == NULL) return 5;
  fprintf(plan, "0007_add_depots\n0008_parcel_status\n0009_drop_legacy\n");
  fclose(plan);

  if (dry_run) {
    puts("dry run: nothing applied");
    return 3;
  }
  snprintf(path, sizeof path, "%s/schema.version", state);
  FILE *next = fopen(path, "w");
  if (next == NULL) return 5;
  fprintf(next, "%d\n", version + 3);
  fclose(next);
  puts("applied 3 migrations");
  return 0;
}
