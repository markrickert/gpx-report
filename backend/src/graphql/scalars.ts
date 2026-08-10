import { GraphQLScalarType, Kind } from "graphql";

export const DateTimeScalar = new GraphQLScalarType({
  name: "DateTime",
  description: "ISO 8601 date-time string",
  serialize: (value: any) => {
    if (value === null || value === undefined) return null;
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  },
  parseValue: (value: any) => new Date(value),
  parseLiteral: (ast) => (ast.kind === Kind.STRING ? new Date(ast.value) : null),
});

export const JSONScalar = new GraphQLScalarType({
  name: "JSON",
  description: "Arbitrary JSON value",
  serialize: (value) => value,
  parseValue: (value) => value,
  parseLiteral: function parseLiteral(ast) {
    switch (ast.kind) {
      case Kind.STRING:
      case Kind.BOOLEAN:
        return ast.value;
      case Kind.INT:
      case Kind.FLOAT:
        return Number(ast.value);
      case Kind.OBJECT: {
        const value: any = {};
        ast.fields.forEach((field) => {
          value[field.name.value] = parseLiteral(field.value);
        });
        return value;
      }
      case Kind.LIST:
        return ast.values.map(parseLiteral);
      case Kind.NULL:
        return null;
      default:
        return null;
    }
  },
});
