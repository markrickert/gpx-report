import { describe, it, expect } from "vitest";
import { Kind } from "graphql";
import { DateTimeScalar, JSONScalar } from "./scalars.js";

describe("DateTimeScalar", () => {
  it("serializes a Date to an ISO string", () => {
    const date = new Date("2024-01-01T12:00:00.000Z");
    expect(DateTimeScalar.serialize(date)).toBe("2024-01-01T12:00:00.000Z");
  });

  it("serializes a non-Date value by coercing through Date", () => {
    expect(DateTimeScalar.serialize("2024-01-01T00:00:00Z")).toBe("2024-01-01T00:00:00.000Z");
  });

  it("serializes null/undefined to null", () => {
    expect(DateTimeScalar.serialize(null)).toBeNull();
    expect(DateTimeScalar.serialize(undefined)).toBeNull();
  });

  it("parses an input value into a Date", () => {
    const parsed = DateTimeScalar.parseValue("2024-01-01T00:00:00Z");
    expect(parsed).toBeInstanceOf(Date);
    expect(parsed.toISOString()).toBe("2024-01-01T00:00:00.000Z");
  });

  it("parses a string literal from a query AST", () => {
    const parsed = DateTimeScalar.parseLiteral({
      kind: Kind.STRING,
      value: "2024-01-01T00:00:00Z",
    });
    expect(parsed).toBeInstanceOf(Date);
  });

  it("returns null for a non-string literal", () => {
    expect(DateTimeScalar.parseLiteral({ kind: Kind.INT, value: "1" })).toBeNull();
  });
});

describe("JSONScalar", () => {
  it("serializes and parseValues pass through unchanged", () => {
    const value = { a: 1, b: [1, 2, 3] };
    expect(JSONScalar.serialize(value)).toBe(value);
    expect(JSONScalar.parseValue(value)).toBe(value);
  });

  it("parses scalar literal kinds", () => {
    expect(JSONScalar.parseLiteral({ kind: Kind.STRING, value: "hi" })).toBe("hi");
    expect(JSONScalar.parseLiteral({ kind: Kind.BOOLEAN, value: true })).toBe(true);
    expect(JSONScalar.parseLiteral({ kind: Kind.INT, value: "42" })).toBe(42);
    expect(JSONScalar.parseLiteral({ kind: Kind.FLOAT, value: "4.2" })).toBe(4.2);
    expect(JSONScalar.parseLiteral({ kind: Kind.NULL })).toBeNull();
    expect(JSONScalar.parseLiteral({ kind: Kind.ENUM, value: "X" })).toBeNull();
  });

  it("recursively parses a nested object literal", () => {
    const ast = {
      kind: Kind.OBJECT,
      fields: [
        { name: { value: "a" }, value: { kind: Kind.INT, value: "1" } },
        {
          name: { value: "b" },
          value: {
            kind: Kind.LIST,
            values: [
              { kind: Kind.STRING, value: "x" },
              { kind: Kind.BOOLEAN, value: false },
            ],
          },
        },
      ],
    };
    expect(JSONScalar.parseLiteral(ast)).toEqual({ a: 1, b: ["x", false] });
  });
});
