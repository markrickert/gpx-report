import { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@apollo/client";
import { Link, useFocusEffect } from "expo-router";
import {
  formatTripDistance,
  formatTripRange,
  myTotal,
  paceLabel,
  tripBar,
} from "@/components/trip-progress";
import { GET_TRIPS } from "@/graphql/queries";
import { useTheme } from "@/hooks/use-theme";
import { DEFAULT_PERSON, personSlug, usePerson } from "@/lib/person";
import { tripPace } from "@/utils/trip-pace";
import { useUnits } from "@/utils/units";

type Trip = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  goalMeters: number;
  goalMaxMeters: number | null;
  participants: { person: string; equivalentMeters: number }[];
};

/** The trips this phone's person is still training for, with their own progress. */
export function TripsCard() {
  const colors = useTheme();
  const { unit } = useUnits();
  const person = personSlug(usePerson() ?? DEFAULT_PERSON);
  const { data, refetch } = useQuery(GET_TRIPS, { fetchPolicy: "cache-and-network" });
  // Progress moves with every upload, so look again each time History shows.
  useFocusEffect(
    useCallback(() => {
      refetch().catch(() => {});
    }, [refetch]),
  );
  const trips: Trip[] = (data?.trips ?? []).filter(
    (trip: Trip) => !tripPace({ ...trip, totalMeters: 0 }).isPast,
  );

  return (
    <View style={styles.card}>
      {trips.map((trip) => {
        const total = myTotal(trip, person);
        const percent = Math.round((total / trip.goalMeters) * 100);
        const bar = tripBar(trip, total);
        const { daysRemaining } = tripPace({ ...trip, totalMeters: total });
        return (
          <Link key={trip.id} href={`/trips/${trip.id}`} asChild>
            <Pressable
              style={StyleSheet.flatten([
                styles.row,
                { backgroundColor: colors.backgroundElement },
              ])}
            >
              <View style={styles.line}>
                <Text style={[styles.title, { color: colors.text }]}>{trip.name}</Text>
                <Text style={[styles.meta, { color: colors.textSecondary }]}>
                  {`${daysRemaining} ${daysRemaining === 1 ? "day" : "days"} left`}
                </Text>
              </View>
              <View style={[styles.bar, { backgroundColor: colors.border }]}>
                <View style={[styles.fill, { width: `${bar.fill}%` }]} />
                {bar.low != null && (
                  <View
                    style={[styles.low, { left: `${bar.low}%`, backgroundColor: colors.text }]}
                  />
                )}
              </View>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>
                {`${formatTripDistance(total, unit)} of ${formatTripRange(trip.goalMeters, trip.goalMaxMeters, unit)} (${percent}%) — ${paceLabel(trip, total, unit)}`}
              </Text>
            </Pressable>
          </Link>
        );
      })}
      <Link href="/trips" asChild>
        <Pressable>
          <Text style={styles.link}>
            {trips.length > 0 ? "All trips" : "Training for a trip? Add it"}
          </Text>
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8 },
  row: { padding: 12, borderRadius: 12, borderCurve: "continuous", gap: 6 },
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 },
  title: { fontSize: 16, fontWeight: "600", flexShrink: 1 },
  meta: { fontSize: 13 },
  bar: { height: 8, borderRadius: 999, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 999, backgroundColor: "#2563eb" },
  low: { position: "absolute", top: 0, bottom: 0, width: 2 },
  link: { color: "#2563eb", fontSize: 14, fontWeight: "600" },
});
