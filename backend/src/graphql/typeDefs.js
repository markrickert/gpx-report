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
    notes: String
    route: Route!
  }

  type Route {
    coordinates: JSON!
    elevationProfile: JSON!
    liftSegments: [LiftSegment!]!
  }

  type LiftSegment {
    startIndex: Int!
    endIndex: Int!
    durationSeconds: Int!
    elevationGainMeters: Float!
    avgSpeedMps: Float!
  }

  type LiftActivitySummary {
    activityId: ID!
    title: String!
    activityType: String!
    startTime: DateTime!
    liftSegmentCount: Int!
    totalLiftElevationGainMeters: Float!
  }

  type ActivitySummary {
    totalActivities: Int!
    totalDistanceMeters: Float!
    totalDurationSeconds: Int!
    totalElevationGainMeters: Float
    lastReanalysis: DateTime
  }

  type ActivityStreak {
    currentStreakDays: Int!
    longestStreakDays: Int!
  }

  type YearToDateTotals {
    year: Int!
    activityCount: Int!
    totalDistanceMeters: Float!
    totalElevationGainMeters: Float!
  }

  type YearOverYearComparison {
    currentYear: YearToDateTotals!
    previousYear: YearToDateTotals!
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

  type SaveRecordedActivityResult {
    filename: String!
  }

  type OutlierSummary {
    activityId: ID!
    title: String!
    activityType: String!
    startTime: DateTime!
    gpxFilename: String!
    outlierPointCount: Int!
  }

  type OutlierPoint {
    index: Int!
    lat: Float!
    lon: Float!
    elevation: Float
    timestamp: Float
    impliedSpeedMps: Float
  }

  type ActivityOutlierDiff {
    activityId: ID!
    outlierPoints: [OutlierPoint!]!
    originalPointCount: Int!
    cleanedPointCount: Int!
    originalMaxSpeedMps: Float
    cleanedMaxSpeedMps: Float
    originalDistanceMeters: Float!
    cleanedDistanceMeters: Float!
  }

  type Query {
    activity(id: ID!): Activity
    activities(
      limit: Int = 20
      offset: Int = 0
      activityType: String
      startDate: DateTime
      endDate: DateTime
      search: String
    ): [Activity!]!
    activitySummary: ActivitySummary!
    aggregatedStatsByType(
      activityType: String
      startDate: DateTime
      endDate: DateTime
    ): [AggregatedStatsByType!]!
    heatmapPoints: JSON!
    activitiesWithOutliers: [OutlierSummary!]!
    activityOutlierDiff(id: ID!): ActivityOutlierDiff!
    activitiesWithLiftSegments: [LiftActivitySummary!]!
    onThisDay: [Activity!]!
    activityStreak: ActivityStreak!
    yearOverYearComparison: YearOverYearComparison!
  }

  type Mutation {
    reanalyzeAllActivities: ReanalysisStatus!
    reanalyzeActivitiesByDateRange(startDate: DateTime!, endDate: DateTime!): ReanalysisStatus!
    updateActivityTitle(id: ID!, title: String!): Activity!
    updateActivityNotes(id: ID!, notes: String!): Activity!
    updateActivityType(id: ID!, activityType: String!): Activity!
    trimActivity(id: ID!, startIndex: Int!, endIndex: Int!): Activity!
    saveRecordedActivity(gpxContent: String!): SaveRecordedActivityResult!
    setCodeServerTheme(theme: String!): Boolean!
    cleanActivityOutliers(id: ID!): Activity!
  }
`;
