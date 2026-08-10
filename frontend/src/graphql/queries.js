import { gql } from "@apollo/client";

export const GET_DASHBOARD = gql`
  query GetDashboard($activityType: String, $limit: Int, $offset: Int, $search: String) {
    activitySummary {
      totalActivities
      totalDistanceMeters
      totalDurationSeconds
      totalElevationGainMeters
      lastReanalysis
    }
    activities(limit: $limit, offset: $offset, activityType: $activityType, search: $search) {
      id
      title
      activityType
      startTime
      durationSeconds
      distanceMeters
      avgSpeedMps
      totalElevationGain
      locationName
      routeThumbnail
    }
  }
`;

export const GET_ON_THIS_DAY = gql`
  query GetOnThisDay {
    onThisDay {
      id
      title
      activityType
      startTime
      distanceMeters
    }
  }
`;

export const GET_ACTIVITY = gql`
  query GetActivity($id: ID!) {
    activity(id: $id) {
      id
      gpxFilename
      title
      activityType
      startTime
      endTime
      durationSeconds
      distanceMeters
      avgSpeedMps
      movingAvgSpeedMps
      maxSpeedMps
      totalElevationGain
      totalElevationLoss
      notes
      locationName
      best1kmSeconds
      best5kmSeconds
      best10kmSeconds
      suggestedActivityTypes
      route {
        coordinates
        elevationProfile
        liftSegments {
          startIndex
          endIndex
          durationSeconds
          elevationGainMeters
          avgSpeedMps
        }
      }
      similarActivities {
        id
        title
        activityType
        startTime
        distanceMeters
      }
      previousActivityId
      nextActivityId
    }
  }
`;

export const SEARCH_ACTIVITIES_FOR_COMPARE = gql`
  query SearchActivitiesForCompare($search: String, $limit: Int) {
    activities(search: $search, limit: $limit) {
      id
      title
      activityType
      startTime
      distanceMeters
    }
  }
`;

export const UPDATE_ACTIVITY_TITLE = gql`
  mutation UpdateActivityTitle($id: ID!, $title: String!) {
    updateActivityTitle(id: $id, title: $title) {
      id
      title
    }
  }
`;

export const UPDATE_ACTIVITY_NOTES = gql`
  mutation UpdateActivityNotes($id: ID!, $notes: String!) {
    updateActivityNotes(id: $id, notes: $notes) {
      id
      notes
    }
  }
`;

export const UPDATE_ACTIVITY_TYPE = gql`
  mutation UpdateActivityType($id: ID!, $activityType: String!) {
    updateActivityType(id: $id, activityType: $activityType) {
      id
      activityType
    }
  }
`;

export const TRIM_ACTIVITY = gql`
  mutation TrimActivity($id: ID!, $startIndex: Int!, $endIndex: Int!) {
    trimActivity(id: $id, startIndex: $startIndex, endIndex: $endIndex) {
      id
    }
  }
`;

export const REANALYZE_ALL = gql`
  mutation ReanalyzeAll {
    reanalyzeAllActivities {
      success
      message
    }
  }
`;

export const REANALYZE_RANGE = gql`
  mutation ReanalyzeRange($startDate: DateTime!, $endDate: DateTime!) {
    reanalyzeActivitiesByDateRange(startDate: $startDate, endDate: $endDate) {
      success
      message
    }
  }
`;

export const GET_HEATMAP_POINTS = gql`
  query GetHeatmapPoints {
    heatmapPoints
  }
`;

export const GET_RECENT_ACTIVITY_BOUNDS = gql`
  query GetRecentActivityBounds {
    recentActivityBounds
  }
`;

export const GET_ACTIVITY_STREAK = gql`
  query GetActivityStreak {
    activityStreak {
      currentStreakDays
      longestStreakDays
    }
  }
`;

export const GET_YEAR_OVER_YEAR_COMPARISON = gql`
  query GetYearOverYearComparison {
    yearOverYearComparison {
      currentYear {
        year
        activityCount
        totalDistanceMeters
        totalElevationGainMeters
      }
      previousYear {
        year
        activityCount
        totalDistanceMeters
        totalElevationGainMeters
      }
    }
  }
`;

export const GET_TRAINING_LOAD = gql`
  query GetTrainingLoad {
    trainingLoad {
      acuteDistanceMeters
      chronicWeeklyAvgDistanceMeters
      ratio
      label
    }
  }
`;

export const GET_ACTIVITY_DATES = gql`
  query GetActivityDates {
    activities(limit: 1000) {
      id
      startTime
      activityType
      distanceMeters
      durationSeconds
      totalElevationGain
      avgSpeedMps
    }
  }
`;

export const SAVE_RECORDED_ACTIVITY = gql`
  mutation SaveRecordedActivity($gpxContent: String!) {
    saveRecordedActivity(gpxContent: $gpxContent) {
      filename
    }
  }
`;

export const GET_RECENT_ACTIVITIES_FOR_POLL = gql`
  query GetRecentActivitiesForPoll {
    activities(limit: 5) {
      id
      gpxFilename
    }
  }
`;

export const GET_LATEST_ACTIVITY_FOR_NOTIFY = gql`
  query GetLatestActivityForNotify {
    activities(limit: 1) {
      id
      title
    }
  }
`;

export const GET_ACTIVITIES_WITH_OUTLIERS = gql`
  query GetActivitiesWithOutliers {
    activitiesWithOutliers {
      activityId
      title
      activityType
      startTime
      gpxFilename
      outlierPointCount
    }
  }
`;

export const GET_ACTIVITY_OUTLIER_DIFF = gql`
  query GetActivityOutlierDiff($id: ID!) {
    activityOutlierDiff(id: $id) {
      activityId
      outlierPoints {
        index
        lat
        lon
        elevation
        timestamp
        impliedSpeedMps
      }
      originalPointCount
      cleanedPointCount
      originalMaxSpeedMps
      cleanedMaxSpeedMps
      originalDistanceMeters
      cleanedDistanceMeters
    }
  }
`;

export const GET_ACTIVITIES_WITH_ELEVATION_SPIKES = gql`
  query GetActivitiesWithElevationSpikes {
    activitiesWithElevationSpikes {
      activityId
      title
      activityType
      startTime
      gpxFilename
      spikeCount
      totalElevationDeltaMeters
    }
  }
`;

export const GET_ACTIVITY_ELEVATION_FIX_DIFF = gql`
  query GetActivityElevationFixDiff($id: ID!) {
    activityElevationFixDiff(id: $id) {
      activityId
      spikePoints {
        index
        lat
        lon
        originalElevation
        correctedElevation
        timestamp
      }
      originalElevationGain
      correctedElevationGain
      originalElevationLoss
      correctedElevationLoss
    }
  }
`;

export const FIX_ACTIVITY_ELEVATION_SPIKES = gql`
  mutation FixActivityElevationSpikes($id: ID!) {
    fixActivityElevationSpikes(id: $id) {
      id
    }
  }
`;

export const GET_ACTIVITIES_WITH_LIFT_SEGMENTS = gql`
  query GetActivitiesWithLiftSegments {
    activitiesWithLiftSegments {
      activityId
      title
      activityType
      startTime
      liftSegmentCount
      totalLiftElevationGainMeters
    }
  }
`;

export const CLEAN_ACTIVITY_OUTLIERS = gql`
  mutation CleanActivityOutliers($id: ID!) {
    cleanActivityOutliers(id: $id) {
      id
    }
  }
`;

export const DELETE_ACTIVITY = gql`
  mutation DeleteActivity($id: ID!) {
    deleteActivity(id: $id)
  }
`;

export const GET_STATS_BY_TYPE = gql`
  query GetStatsByType {
    aggregatedStatsByType {
      activityType
      count
      totalDistanceMeters
      totalDurationSeconds
      averageDistanceMeters
      averageDurationSeconds
      averageElevationGainMeters
    }
  }
`;

export const GET_PERSONAL_RECORDS = gql`
  query GetPersonalRecords {
    personalRecordsByType {
      activityType
      longestDistanceMeters
      biggestElevationGainMeters
      best1kmSeconds
      best5kmSeconds
      best10kmSeconds
    }
  }
`;
