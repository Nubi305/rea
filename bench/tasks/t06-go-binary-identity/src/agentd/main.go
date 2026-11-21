// Command agentd reports a vehicle's position to the fleet service.
package main

import (
	"fmt"
	"os"
	"strings"

	"example.test/fleet/wire"
)

var channel = "stable"

func updateURL(base string) string {
	return strings.TrimRight(base, "/") + "/v2/agents/" + channel + "/manifest.json"
}

func main() {
	base := os.Getenv("FLEET_UPDATE_BASE")
	if base == "" {
		base = "https://updates.fleet.example.test"
	}
	frame := wire.Encode(wire.Position{Vehicle: "van-7", Latitude: 52.37, Longitude: 4.89})
	fmt.Println(updateURL(base), len(frame))
}
