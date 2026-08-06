export const typeDefs = `#graphql
  scalar DateTime
  scalar JSON

  type Activity {
    id: ID!
    gpxFilename: String!
    title: String!
    activityType: String!
    startTime: DateTime!
    endTime: DateTime!
    durationSeconds: Int!
    distanceMeters: Float!
    avgSpeedMps: Float
    maxSpeedMps: Float
    totalElevationGain: Float
    totalElevationLoss: Float
    route: Route!
  }

  type Route {
    coordinates: JSON!
    elevationProfile: JSON!
  }

  type ActivitySummary {
    totalActivities: Int!
    totalDistanceMeters: Float!
    totalDurationSeconds: Int!
    totalElevationGainMeters: Float
    lastReanalysis: DateTime
  }

  type AggregatedStatsByType {
    activityType: String!
    count: Int!
    totalDistanceMeters: Float!
    totalDurationSeconds: Int!
    averageDistanceMeters: Float!
    averageDurationSeconds: Int!
    averageElevationGainMeters: Float
  }

  type ReanalysisStatus {
    message: String!
    success: Boolean!
  }

  type Query {
    activity(id: ID!): Activity
    activities(
      limit: Int = 20
      offset: Int = 0
      activityType: String
      startDate: DateTime
      endDate: DateTime
    ): [Activity!]!
    activitySummary: ActivitySummary!
    aggregatedStatsByType(
      activityType: String
      startDate: DateTime
      endDate: DateTime
    ): [AggregatedStatsByType!]!
  }

  type Mutation {
    reanalyzeAllActivities: ReanalysisStatus!
    reanalyzeActivitiesByDateRange(startDate: DateTime!, endDate: DateTime!): ReanalysisStatus!
    updateActivityTitle(id: ID!, title: String!): Activity!
    updateActivityType(id: ID!, activityType: String!): Activity!
    trimActivity(id: ID!, startIndex: Int!, endIndex: Int!): Activity!
  }
`;
