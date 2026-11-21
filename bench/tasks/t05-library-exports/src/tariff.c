#define PUBLIC __attribute__((visibility("default")))

static const char VERSION[] = "tariff 3.4.1";

/* Internal: not part of the library's interface. */
long round_half_up(double value) {
  return (long)(value + 0.5);
}

long started_kilograms(double weight_kg) {
  long whole = (long)weight_kg;
  return weight_kg > (double)whole ? whole + 1 : whole;
}

PUBLIC long tariff_quote(double weight_kg, int fragile) {
  long cents = 350 + 120 * started_kilograms(weight_kg);
  return fragile ? round_half_up((double)cents * 1.15) : cents;
}

PUBLIC const char *tariff_version(void) {
  return VERSION;
}

PUBLIC int tariff_limit_kg = 30;
