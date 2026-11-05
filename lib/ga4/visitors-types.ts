// lib/ga4/visitors-types.ts — 방문자 GA4 조회 결과 타입(visitors.ts 에서 분리)
export interface OverviewKpi {
  sessions: number;
  sessionsDelta: number;
  activeUsers: number;
  activeUsersDelta: number;
  newUsers: number;
  newUsersDelta: number;
  pageViews: number;
  pageViewsDelta: number;
  bounceRate: number;
  bounceRateDelta: number;
  avgSessionDuration: number;
  avgSessionDurationDelta: number;
  engagementRate: number;
  engagementRateDelta: number;
  eventsPerSession: number;
}

export interface TrafficSource {
  channel: string;
  sessions: number;
  percentage: number;
}

export interface DailyPoint {
  date: string;
  views: number;
  sessions: number;
}

export interface TopPage {
  path: string;
  title: string;
  views: number;
  avgTimeOnPage: number;
  bounceRate: number;
}

export interface ReferralSource {
  source: string;
  medium: string;
  sessions: number;
  percentage: number;
}

export interface SearchTermRow {
  term: string;
  sessions: number;
}

export interface AgeGroup {
  bracket: string;
  users: number;
  percentage: number;
}

export interface GenderRow {
  gender: string;
  users: number;
  percentage: number;
}

export interface CityRow {
  city: string;
  users: number;
  percentage: number;
}

export interface CountryRow {
  country: string;
  users: number;
  percentage: number;
}

export interface DeviceRow {
  device: string;
  sessions: number;
  percentage: number;
}

export interface BrowserRow {
  browser: string;
  sessions: number;
  percentage: number;
}

export interface OsRow {
  os: string;
  sessions: number;
  percentage: number;
}

export interface LandingPage {
  path: string;
  sessions: number;
  bounceRate: number;
}

export interface ExitPage {
  path: string;
  exits: number;
}
