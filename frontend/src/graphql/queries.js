import { gql } from "@apollo/client";

export const GET_DASHBOARD = gql`
  query GetDashboard($activityType: String, $limit: Int, $offset: Int) {
    activitySummary {
      totalActivities
      totalDistanceMeters
      totalDurationSeconds
      totalElevationGainMeters
      lastReanalysis
    }
    activities(limit: $limit, offset: $offset, activityType: $activityType) {
      id
      title
      activityType
      startTime
      durationSeconds
      distanceMeters
      route {
        coordinates
      }
    }
  }
`;

export const GET_ACTIVITY = gql`
  query GetActivity($id: ID!) {
    activity(id: $id) {
      id
      title
      activityType
      startTime
      endTime
      durationSeconds
      distanceMeters
      avgSpeedMps
      maxSpeedMps
      totalElevationGain
      totalElevationLoss
      route {
        coordinates
        elevationProfile
      }
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
