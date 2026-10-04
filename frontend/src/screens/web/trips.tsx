import { useState } from "react";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useQuery } from "@apollo/client";
import { Link } from "@/components/web-link";
import { TripForm } from "@/components/trip-form";
import { TripProgress, formatTripDate, myTotal } from "@/components/trip-progress";
import { GET_TRIPS } from "@/graphql/queries";
import { usePersonHref } from "@/lib/person";
import { tripPace } from "@/utils/trip-pace";

function TripList({ title, trips }) {
  const { person } = useLocalSearchParams<{ person: string }>();
  const href = usePersonHref();
  if (trips.length === 0) return null;

  return (
    <section>
      <h2>{title}</h2>
      <ul className="trip-list">
        {trips.map((trip) => (
          <li key={trip.id} className="trip-card">
            <div className="trip-card-header">
              <Link to={href(`/trips/${trip.id}`)}>{trip.name}</Link>
              <span className="trip-dates">
                {formatTripDate(trip.startDate)} – {formatTripDate(trip.endDate)}
                {trip.participants.length > 1 && ` · ${trip.participants.length} people`}
              </span>
            </div>
            <TripProgress trip={trip} totalMeters={myTotal(trip, person)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Trips() {
  const href = usePersonHref();
  // Progress moves whenever an activity lands, so never trust the cache alone.
  const { data, error } = useQuery(GET_TRIPS, { fetchPolicy: "cache-and-network" });
  const [creating, setCreating] = useState(false);

  if (error) return <p>Error loading trips: {error.message}</p>;
  if (!data) return <p>Loading...</p>;

  const isPast = (trip) => tripPace({ ...trip, totalMeters: 0 }).isPast;
  const active = data.trips.filter((trip) => !isPast(trip));
  // Most recently finished first.
  const past = data.trips.filter(isPast).reverse();

  return (
    <div>
      <div className="heatmap-header-row">
        <h1>Trips</h1>
        {!creating && (
          <button type="button" className="title-edit-button" onClick={() => setCreating(true)}>
            New trip
          </button>
        )}
      </div>
      {creating && (
        <TripForm
          onSaved={(id) => router.push(href(`/trips/${id}`) as Href)}
          onCancel={() => setCreating(false)}
        />
      )}
      {data.trips.length === 0 && !creating && (
        <p>
          No trips yet. Add the trip you&apos;re training for, with a date and a distance goal, and
          every activity until then counts toward it.
        </p>
      )}
      <TripList title="Active" trips={active} />
      <TripList title="Past" trips={past} />
    </div>
  );
}
