/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as activity from "../activity.js";
import type * as admin from "../admin.js";
import type * as auditLog from "../auditLog.js";
import type * as availability from "../availability.js";
import type * as coachAvailability from "../coachAvailability.js";
import type * as coachProfiles from "../coachProfiles.js";
import type * as coachingBookings from "../coachingBookings.js";
import type * as coachingPayments from "../coachingPayments.js";
import type * as coachingReviews from "../coachingReviews.js";
import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as damageInvoices from "../damageInvoices.js";
import type * as dateUtils from "../dateUtils.js";
import type * as disputes from "../disputes.js";
import type * as driverMedia from "../driverMedia.js";
import type * as driverProfiles from "../driverProfiles.js";
import type * as emails from "../emails.js";
import type * as endorsements from "../endorsements.js";
import type * as errors from "../errors.js";
import type * as favorites from "../favorites.js";
import type * as follows from "../follows.js";
import type * as geocoding from "../geocoding.js";
import type * as helpers from "../helpers.js";
import type * as http from "../http.js";
import type * as init from "../init.js";
import type * as invoices from "../invoices.js";
import type * as logger from "../logger.js";
import type * as messageTemplates from "../messageTemplates.js";
import type * as messages from "../messages.js";
import type * as migrations from "../migrations.js";
import type * as motorsportsMatching from "../motorsportsMatching.js";
import type * as notificationCron from "../notificationCron.js";
import type * as notifications from "../notifications.js";
import type * as posts from "../posts.js";
import type * as presence from "../presence.js";
import type * as pricing from "../pricing.js";
import type * as profileViews from "../profileViews.js";
import type * as r2 from "../r2.js";
import type * as raceEvents from "../raceEvents.js";
import type * as raceSeries from "../raceSeries.js";
import type * as rateLimitHelpers from "../rateLimitHelpers.js";
import type * as rateLimiter from "../rateLimiter.js";
import type * as reliability from "../reliability.js";
import type * as rentalCompletions from "../rentalCompletions.js";
import type * as reports from "../reports.js";
import type * as reservations from "../reservations.js";
import type * as reviewStats from "../reviewStats.js";
import type * as reviews from "../reviews.js";
import type * as sanitize from "../sanitize.js";
import type * as seedCoaches from "../seedCoaches.js";
import type * as speedhive from "../speedhive.js";
import type * as seatBookings from "../seatBookings.js";
import type * as seatHelpers from "../seatHelpers.js";
import type * as seatPayments from "../seatPayments.js";
import type * as seatOfferings from "../seatOfferings.js";
import type * as stripe from "../stripe.js";
import type * as teamApplications from "../teamApplications.js";
import type * as teamCars from "../teamCars.js";
import type * as teamDriverConnections from "../teamDriverConnections.js";
import type * as teamEvents from "../teamEvents.js";
import type * as teamMembers from "../teamMembers.js";
import type * as teamResultLinks from "../teamResultLinks.js";
import type * as teams from "../teams.js";
import type * as timingResults from "../timingResults.js";
import type * as tracks from "../tracks.js";
import type * as userBlocks from "../userBlocks.js";
import type * as users from "../users.js";
import type * as vehicleAnalytics from "../vehicleAnalytics.js";
import type * as vehicleMakes from "../vehicleMakes.js";
import type * as vehicles from "../vehicles.js";
import type * as webhookIdempotency from "../webhookIdempotency.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  admin: typeof admin;
  auditLog: typeof auditLog;
  availability: typeof availability;
  coachAvailability: typeof coachAvailability;
  coachProfiles: typeof coachProfiles;
  coachingBookings: typeof coachingBookings;
  coachingPayments: typeof coachingPayments;
  coachingReviews: typeof coachingReviews;
  conversations: typeof conversations;
  crons: typeof crons;
  damageInvoices: typeof damageInvoices;
  dateUtils: typeof dateUtils;
  disputes: typeof disputes;
  driverMedia: typeof driverMedia;
  driverProfiles: typeof driverProfiles;
  emails: typeof emails;
  endorsements: typeof endorsements;
  errors: typeof errors;
  favorites: typeof favorites;
  follows: typeof follows;
  geocoding: typeof geocoding;
  helpers: typeof helpers;
  http: typeof http;
  init: typeof init;
  invoices: typeof invoices;
  logger: typeof logger;
  messageTemplates: typeof messageTemplates;
  messages: typeof messages;
  migrations: typeof migrations;
  motorsportsMatching: typeof motorsportsMatching;
  notificationCron: typeof notificationCron;
  notifications: typeof notifications;
  posts: typeof posts;
  presence: typeof presence;
  pricing: typeof pricing;
  profileViews: typeof profileViews;
  r2: typeof r2;
  raceEvents: typeof raceEvents;
  raceSeries: typeof raceSeries;
  rateLimitHelpers: typeof rateLimitHelpers;
  rateLimiter: typeof rateLimiter;
  reliability: typeof reliability;
  rentalCompletions: typeof rentalCompletions;
  reports: typeof reports;
  reservations: typeof reservations;
  reviewStats: typeof reviewStats;
  reviews: typeof reviews;
  sanitize: typeof sanitize;
  seedCoaches: typeof seedCoaches;
  speedhive: typeof speedhive;
  seatBookings: typeof seatBookings;
  seatHelpers: typeof seatHelpers;
  seatPayments: typeof seatPayments;
  seatOfferings: typeof seatOfferings;
  stripe: typeof stripe;
  teamApplications: typeof teamApplications;
  teamCars: typeof teamCars;
  teamDriverConnections: typeof teamDriverConnections;
  teamEvents: typeof teamEvents;
  teamMembers: typeof teamMembers;
  teamResultLinks: typeof teamResultLinks;
  teams: typeof teams;
  timingResults: typeof timingResults;
  tracks: typeof tracks;
  userBlocks: typeof userBlocks;
  users: typeof users;
  vehicleAnalytics: typeof vehicleAnalytics;
  vehicleMakes: typeof vehicleMakes;
  vehicles: typeof vehicles;
  webhookIdempotency: typeof webhookIdempotency;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
export declare const components: any;
