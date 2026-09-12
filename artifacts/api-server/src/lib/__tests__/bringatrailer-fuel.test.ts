import { describe, expect, it } from "vitest";
import { extractBatFuelType } from "../providers/bringatrailer";

describe("extractBatFuelType", () => {
  it("does not treat electrical seats / options as electric fuel", () => {
    expect(extractBatFuelType("8-way electrical seat, left")).toBeUndefined();
    expect(
      extractBatFuelType(
        "This 1996 Porsche 911 Carrera was optioned with the Power Seat Package and a power-operated sunroof. Powered by a 3.6-liter flat-six.",
      ),
    ).toBeUndefined();
    expect(extractBatFuelType("electronic ignition and cruise control")).toBeUndefined();
  });

  it("detects real EV / hybrid / diesel powertrains", () => {
    expect(extractBatFuelType("This all-electric Tesla Model S")).toBe("electric");
    expect(extractBatFuelType("battery-electric Rivian R1T")).toBe("electric");
    expect(extractBatFuelType("powered by an electric motor")).toBe("electric");
    expect(extractBatFuelType("3.0-liter diesel inline-six")).toBe("diesel");
    expect(extractBatFuelType("plugin hybrid powertrain")).toBe("hybrid");
  });
});
