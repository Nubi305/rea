#include <stdio.h>
#include <string.h>

/* Copies the caller's name into a fixed buffer and greets it. */
int main(int argc, char **argv) {
  char name[32];
  if (argc < 2) {
    puts("usage: keyd <name>");
    return 2;
  }
  strncpy(name, argv[1], sizeof name - 1);
  name[sizeof name - 1] = 0;
  printf("hello %s\n", name);
  return 0;
}
