// Package wire encodes position reports.
package wire

import "fmt"

// Position is one report.
type Position struct {
	Vehicle   string
	Latitude  float64
	Longitude float64
}

// Encode renders a report as one line.
func Encode(position Position) []byte {
	return []byte(fmt.Sprintf("%s;%.5f;%.5f\n", position.Vehicle, position.Latitude, position.Longitude))
}
