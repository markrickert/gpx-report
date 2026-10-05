export const typeDefs = `#graphql
  scalar DateTime
  scalar JSON

  type Activity {
    id: ID!
    gpxFilename: String!
    owner: String!
    sharedWith: [String!]!
    title: String!
    activityType: String!
    startTime: DateTime!
    endTime: DateTime!
    durationSeconds: Int!
    distanceMeters: Float!
    avgSpeedMps: Float
    movingAvgSpeedMps: Float
    maxSpeedMps: Float
    totalElevationGain: Float
    totalElevationLoss: Float
    avgHr: Float
    maxHr: Float
    notes: String
    locationName: String
    best1kmSeconds: Float
    best5kmSeconds: Float
    best10kmSeconds: Float
    route: Route!
    routeThumbnail: JSON
    similarActivities: [SimilarActivity!]!
    previousActivityId: ID
    nextActivityId: ID
    suggestedActivityTypes: [String!]!
    mediaCount: Int!
    media: [ActivityMedia!]!
    "True once the track's points have been edited (trimmed, cleaned, or elevation-fixed) since the original saved in _backups/. Title and type edits don't count."
    trackEdited: Boolean!
    "True for an activity typed in by hand, which has no track."
    isManual: Boolean!
  }

  type ActivityMedia {
    id: ID!
    immichAssetId: String!
    assetType: String!
    takenAt: DateTime!
    lat: Float
    lon: Float
    durationSeconds: Float
  }

  type ImmichSettings {
    immichBaseUrl: String
    configured: Boolean!
  }

  type ImmichScanResult {
    scannedActivities: Int!
    matchedAssets: Int!
  }

  type SimilarActivity {
    id: ID!
    title: String!
    activityType: String!
    startTime: DateTime!
    distanceMeters: Float!
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

  type TrainingLoad {
    acuteDistanceMeters: Float!
    chronicWeeklyAvgDistanceMeters: Float!
    ratio: Float
    label: String!
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

  type PersonalRecord {
    activityType: String!
    longestDistanceMeters: Float!
    biggestElevationGainMeters: Float
    best1kmSeconds: Float
    best5kmSeconds: Float
    best10kmSeconds: Float
  }

  type ReanalysisStatus {
    message: String!
    success: Boolean!
  }

  type SaveRecordedActivityResult {
    filename: String!
  }

  "IMPORTED, ALREADY_IMPORTED (same bytes are already on the server), DUPLICATE (another file with the same start), or REJECTED."
  type ImportActivityFileResult {
    status: String!
    activityId: ID
    title: String
    reason: String
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

  type ElevationSpikeSummary {
    activityId: ID!
    title: String!
    activityType: String!
    startTime: DateTime!
    gpxFilename: String!
    spikeCount: Int!
    totalElevationDeltaMeters: Float!
  }

  type ElevationSpikePoint {
    index: Int!
    lat: Float!
    lon: Float!
    originalElevation: Float
    correctedElevation: Float
    timestamp: Float
  }

  type ActivityTerrainElevationDiff {
    activityId: ID!
    "One elevation per track point, from the terrain model where it has data."
    elevations: [Float]!
    originalElevationGain: Float
    correctedElevationGain: Float
    originalElevationLoss: Float
    correctedElevationLoss: Float
  }

  type ActivityElevationFixDiff {
    activityId: ID!
    spikePoints: [ElevationSpikePoint!]!
    originalElevationGain: Float
    correctedElevationGain: Float
    originalElevationLoss: Float
    correctedElevationLoss: Float
  }

  type EffortFactor {
    activityType: String!
    factor: Float!
    countsElevation: Boolean!
  }

  type TripParticipant {
    person: String!
    equivalentMeters: Float!
  }

  type TripActivity {
    id: ID!
    title: String!
    activityType: String!
    startTime: DateTime!
    distanceMeters: Float!
    totalElevationGain: Float
    factor: Float!
    equivalentMeters: Float!
  }

  "startDate and endDate are YYYY-MM-DD, both inclusive."
  type Trip {
    id: ID!
    name: String!
    startDate: String!
    endDate: String!
    goalMeters: Float!
    "False when activities count without the climbing credit."
    countsElevation: Boolean!
    "One target per week from startDate, the last week running through endDate. Null when the trip has no plan."
    weeklyTargetsMeters: [Float!]
    participants: [TripParticipant!]!
    "The requesting person's own activities in the window, oldest first."
    myActivities: [TripActivity!]!
  }

  "An activity with no track. startTime is the instant the client picked for the day; without durationSeconds the activity has no time or speed."
  input ManualActivityInput {
    title: String!
    activityType: String!
    startTime: DateTime!
    distanceMeters: Float!
    durationSeconds: Float
    elevationGainMeters: Float
    notes: String
  }

  input TripInput {
    name: String!
    startDate: String!
    endDate: String!
    goalMeters: Float!
    countsElevation: Boolean = true
    "When given, goalMeters is ignored and the goal is their sum."
    weeklyTargetsMeters: [Float!]
    participants: [String!]!
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
    recentActivityBounds(months: Int = 6): JSON
    activitiesWithOutliers: [OutlierSummary!]!
    activityOutlierDiff(id: ID!): ActivityOutlierDiff!
    activitiesWithElevationSpikes: [ElevationSpikeSummary!]!
    activityElevationFixDiff(id: ID!): ActivityElevationFixDiff!
    activityTerrainElevationDiff(id: ID!): ActivityTerrainElevationDiff!
    activitiesWithLiftSegments: [LiftActivitySummary!]!
    onThisDay: [Activity!]!
    activityStreak: ActivityStreak!
    yearOverYearComparison: YearOverYearComparison!
    trainingLoad: TrainingLoad!
    personalRecordsByType: [PersonalRecord!]!
    immichSettings: ImmichSettings!
    people: [String!]!
    trips: [Trip!]!
    trip(id: ID!): Trip
    effortFactors: [EffortFactor!]!
  }

  type Mutation {
    reanalyzeAllActivities: ReanalysisStatus!
    reanalyzeActivitiesByDateRange(startDate: DateTime!, endDate: DateTime!): ReanalysisStatus!
    updateActivityTitle(id: ID!, title: String!): Activity!
    updateActivityNotes(id: ID!, notes: String!): Activity!
    updateActivityType(id: ID!, activityType: String!): Activity!
    trimActivity(id: ID!, startIndex: Int!, endIndex: Int!): Activity!
    restoreActivityOriginal(id: ID!): Activity!
    saveRecordedActivity(gpxContent: String!, clientId: String): SaveRecordedActivityResult!
    importActivityFile(filename: String!, contentBase64: String!): ImportActivityFileResult!
    addManualActivity(input: ManualActivityInput!, clientId: String): Activity!
    updateManualActivity(id: ID!, input: ManualActivityInput!): Activity!
    cleanActivityOutliers(id: ID!): Activity!
    fixActivityElevationSpikes(id: ID!): Activity!
    applyTerrainElevation(id: ID!): Activity!
    deleteActivity(id: ID!): Boolean!
    setActivitySharedWith(id: ID!, people: [String!]!): Activity!
    updateImmichSettings(immichBaseUrl: String!, immichApiKey: String): Boolean!
    scanActivityMedia(activityIds: [ID!]): ImmichScanResult!
    saveTrip(id: ID, input: TripInput!): Trip!
    deleteTrip(id: ID!): Boolean!
  }
`;
