import { useQuery } from "@apollo/client";
import { Link } from "@/components/web-link";
import { GET_PEOPLE } from "@/graphql/queries";

// Landing page: each person has their own dashboard at /<person>/. People
// come from the server's data/gpx/<person>/ folders (plus the default
// person, who owns the top-level files).
export default function PeoplePicker() {
  const { data, loading, error } = useQuery(GET_PEOPLE);

  if (loading) return <p>Loading...</p>;
  if (error) return <p>Error loading people: {error.message}</p>;

  return (
    <section className="on-this-day">
      <h2>Whose activities?</h2>
      <ul className="people-list">
        {data.people.map((person) => (
          <li key={person}>
            <Link to={`/${person}`}>{person}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
