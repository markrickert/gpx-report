import { ApolloProvider } from "@apollo/client";
import { Slot, useLocalSearchParams } from "expo-router";
import { clientFor } from "@/lib/apollo";

// Everything under /<person>/ talks to the server as that person.
export default function PersonLayout() {
  const { person } = useLocalSearchParams<{ person: string }>();
  return (
    <ApolloProvider client={clientFor(person)}>
      <Slot />
    </ApolloProvider>
  );
}
