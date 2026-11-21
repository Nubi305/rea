#include <math.h>

/* A handling fee plus a rate per started kilogram; fragile parcels pay 15% more. */
double tariff_for(double weight_kg, int fragile) {
  double base = 3.5 + 1.2 * ceil(weight_kg);
  return fragile ? base * 1.15 : base;
}
