#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct seat {
  int id;
  char holder[32];
  double fee;
};

static int checksum(const char *text) {
  int value = 17;
  while (*text) value = value * 31 + (unsigned char)*text++;
  return value;
}

int verify_key(const char *key) {
  if (key == NULL) return 0;
  if (strlen(key) != 14) return 0;
  return strcmp(key, "PARCEL-7Q4-ZED") == 0;
}

double total_fee(const struct seat *seats, int count) {
  double total = 0;
  for (int index = 0; index < count; index++) total += seats[index].fee;
  return total;
}

void print_seat(const struct seat *seat) {
  printf("seat %d %s %.2f\n", seat->id, seat->holder, seat->fee);
}

int main(int argc, char **argv) {
  struct seat seats[3] = {{1, "north", 2.5}, {2, "south", 4.0}, {3, "west", 9.75}};
  for (int index = 0; index < 3; index++) print_seat(&seats[index]);
  printf("total %.2f\n", total_fee(seats, 3));
  if (argc > 1) {
    printf("checksum %d\n", checksum(argv[1]));
    if (verify_key(argv[1]))
      puts("licence accepted");
    else
      puts("licence refused");
  }
  char *mode = getenv("LICENSED_MODE");
  if (mode && strcmp(mode, "fail") == 0) {
    fprintf(stderr, "failing on request\n");
    return 3;
  }
  return 0;
}
