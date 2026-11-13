// convex/schema.ts
import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

export default defineSchema({
  users: defineTable({
    externalId: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    rating: v.optional(v.number()),
    totalRentals: v.optional(v.number()),
    memberSince: v.optional(v.string()),
    profileImageR2Key: v.optional(v.string()), // R2 object key for profile image
    profileImage: v.optional(v.string()), // ImageKit or legacy URL for profile image
    isHost: v.optional(v.boolean()),
    isBanned: v.optional(v.boolean()),
    userType: v.optional(v.union(v.literal("driver"), v.literal("team"), v.literal("both"))),
    // Stripe Connect fields
    stripeAccountId: v.optional(v.string()),
    stripeAccountStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("enabled"),
        v.literal("restricted"),
        v.literal("disabled")
      )
    ),
    // Stripe Customer fields (for renters)
    stripeCustomerId: v.optional(v.string()),
    // User interests/preferences
    interests: v.optional(v.array(v.string())), // e.g., ['Track Racing', 'GT3 Cars', 'Formula Racing', 'Endurance']
    // Notification preferences
    notificationPreferences: v.optional(
      v.object({
        reservationUpdates: v.boolean(),
        messages: v.boolean(),
        reviewsAndRatings: v.boolean(),
        paymentUpdates: v.boolean(),
        marketing: v.boolean(),
      })
    ),
    // Owner cancellation tracking
    ownerCancellationCount: v.optional(v.number()),
    // Timestamp of last message digest email sent (to prevent spam)
    lastMessageDigestAt: v.optional(v.number()),
    // Platform fee cap: provider never pays more than this % (effective = min(global, cap))
    platformFeeCapPercentage: v.optional(v.number()),
    isEarlyAdopter: v.optional(v.boolean()),
    earlyAdopterGrantedAt: v.optional(v.number()),
    // User profile fields
    bio: v.optional(v.string()),
    location: v.optional(v.string()),
    experience: v.optional(v.string()),
    // Host onboarding fields
    hostOnboardingStatus: v.optional(
      v.union(v.literal("not_started"), v.literal("in_progress"), v.literal("completed"))
    ),
    hostOnboardingSteps: v.optional(
      v.object({
        personalInfo: v.boolean(),
        vehicleAdded: v.boolean(),
        payoutSetup: v.boolean(),
        safetyStandards: v.boolean(),
      })
    ),
    // Temporary storage for vehicle address during onboarding
    onboardingVehicleAddress: v.optional(
      v.object({
        street: v.string(),
        city: v.string(),
        state: v.string(),
        zipCode: v.string(),
        latitude: v.optional(v.number()),
        longitude: v.optional(v.number()),
      })
    ),
    // Temporary storage for onboarding draft data (allows users to save progress)
    hostOnboardingDraft: v.optional(
      v.object({
        address: v.optional(
          v.object({
            street: v.string(),
            city: v.string(),
            state: v.string(),
            zipCode: v.string(),
            latitude: v.optional(v.number()),
            longitude: v.optional(v.number()),
          })
        ),
        vehicleData: v.optional(
          v.object({
            trackId: v.optional(v.string()),
            make: v.string(),
            model: v.string(),
            year: v.number(),
            dailyRate: v.number(),
            description: v.string(),
            horsepower: v.optional(v.number()),
            transmission: v.optional(v.string()),
            drivetrain: v.optional(v.string()),
            engineType: v.optional(v.string()),
            mileage: v.optional(v.number()),
            amenities: v.array(v.string()),
            addOns: v.array(
              v.object({
                name: v.string(),
                price: v.number(),
                description: v.optional(v.string()),
                isRequired: v.optional(v.boolean()),
                priceType: v.optional(v.union(v.literal("daily"), v.literal("one-time"))),
              })
            ),
            advanceNotice: v.optional(v.string()),
            minTripDuration: v.optional(v.string()),
            maxTripDuration: v.optional(v.string()),
            requireWeekendMin: v.optional(v.boolean()),
          })
        ),
        currentStep: v.optional(v.number()),
        lastSavedAt: v.optional(v.number()),
        // Uploaded image keys from R2 (stored when photos are uploaded)
        images: v.optional(
          v.array(
            v.object({
              r2Key: v.string(),
              isPrimary: v.boolean(),
              order: v.number(),
            })
          )
        ),
      })
    ),
  })
    .index("by_external_id", ["externalId"])
    .index("by_stripe_account", ["stripeAccountId"]),

  tracks: defineTable({
    name: v.string(),
    location: v.string(),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    isActive: v.boolean(),
  }).index("by_active", ["isActive"]),

  vehicles: defineTable({
    ownerId: v.string(),
    trackId: v.id("tracks"),
    make: v.string(),
    model: v.string(),
    year: v.number(),
    dailyRate: v.number(),
    damageDepositAmount: v.optional(v.number()), // Refundable deposit in cents for ACH/debit invoice payments
    description: v.string(),
    horsepower: v.optional(v.number()),
    transmission: v.optional(v.string()),
    drivetrain: v.optional(v.string()),
    engineType: v.optional(v.string()),
    mileage: v.optional(v.number()),
    amenities: v.array(v.string()),
    // Vehicle add-ons with pricing
    addOns: v.array(
      v.object({
        name: v.string(),
        price: v.number(),
        description: v.optional(v.string()),
        isRequired: v.optional(v.boolean()),
        priceType: v.optional(v.union(v.literal("daily"), v.literal("one-time"))),
      })
    ),
    // Listing location address
    address: v.optional(
      v.object({
        street: v.optional(v.string()),
        city: v.optional(v.string()),
        state: v.optional(v.string()),
        zipCode: v.string(),
        latitude: v.optional(v.number()),
        longitude: v.optional(v.number()),
      })
    ),
    // Availability settings
    advanceNotice: v.optional(v.string()),
    minTripDuration: v.optional(v.string()),
    maxTripDuration: v.optional(v.string()),
    requireWeekendMin: v.optional(v.boolean()),
    experienceLevel: v.optional(
      v.union(v.literal("beginner"), v.literal("intermediate"), v.literal("advanced"))
    ),
    tireType: v.optional(v.string()),
    deliveryAvailable: v.optional(v.boolean()),
    // Cancellation policy
    cancellationPolicy: v.optional(
      v.union(v.literal("flexible"), v.literal("moderate"), v.literal("strict"))
    ),
    isActive: v.boolean(),
    isSuspended: v.optional(v.boolean()),
    isApproved: v.optional(v.boolean()),
    viewCount: v.optional(v.number()), // Total views
    shareCount: v.optional(v.number()), // Total shares
    deletedAt: v.optional(v.number()), // Soft delete timestamp
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_track", ["trackId"])
    .index("by_active", ["isActive"])
    .index("by_owner_active", ["ownerId", "isActive"])
    .index("by_approved", ["isApproved"])
    .index("by_active_approved", ["isActive", "isApproved"]),

  vehicleImages: defineTable({
    vehicleId: v.id("vehicles"),
    r2Key: v.optional(v.string()), // R2 object key for the original image
    imageUrl: v.optional(v.string()), // Legacy/external image URL
    isPrimary: v.boolean(),
    order: v.number(),
    metadata: v.optional(
      v.object({
        fileName: v.string(),
        originalSize: v.number(),
        processedSizes: v.object({
          thumbnail: v.number(),
          card: v.number(),
          detail: v.number(),
          hero: v.number(),
        }),
      })
    ),
  })
    .index("by_vehicle", ["vehicleId"])
    .index("by_vehicle_primary", ["vehicleId", "isPrimary"]),

  availability: defineTable({
    vehicleId: v.id("vehicles"),
    date: v.string(), // YYYY-MM-DD format
    isAvailable: v.boolean(),
    reason: v.optional(v.string()), // For blocked dates
    price: v.optional(v.number()), // Override daily rate for specific dates
    createdAt: v.number(),
  })
    .index("by_vehicle_date", ["vehicleId", "date"])
    .index("by_vehicle_available", ["vehicleId", "isAvailable"])
    .index("by_date_available", ["date", "isAvailable"]),

  reservations: defineTable({
    vehicleId: v.id("vehicles"),
    renterId: v.string(),
    ownerId: v.string(),
    startDate: v.string(), // YYYY-MM-DD format
    endDate: v.string(), // YYYY-MM-DD format
    pickupTime: v.optional(v.string()), // HH:MM format (24-hour)
    dropoffTime: v.optional(v.string()), // HH:MM format (24-hour)
    totalDays: v.number(),
    dailyRate: v.number(),
    totalAmount: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("confirmed"),
      v.literal("cancelled"),
      v.literal("completed"),
      v.literal("declined")
    ),
    approvedAt: v.optional(v.number()),
    renterMessage: v.optional(v.string()),
    ownerMessage: v.optional(v.string()),
    cancellationReason: v.optional(v.string()),
    // Add-ons selected for this reservation
    addOns: v.optional(
      v.array(
        v.object({
          name: v.string(),
          price: v.number(),
          description: v.optional(v.string()),
          priceType: v.optional(v.union(v.literal("daily"), v.literal("one-time"))),
        })
      )
    ),
    // Payment-related fields
    paymentId: v.optional(v.id("payments")),
    paymentStatus: v.optional(
      v.union(v.literal("pending"), v.literal("paid"), v.literal("failed"), v.literal("refunded"))
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_vehicle", ["vehicleId"])
    .index("by_renter", ["renterId"])
    .index("by_owner", ["ownerId"])
    .index("by_status", ["status"])
    .index("by_renter_status", ["renterId", "status"])
    .index("by_owner_status", ["ownerId", "status"])
    .index("by_dates", ["startDate", "endDate"]),

  favorites: defineTable({
    userId: v.string(),
    vehicleId: v.id("vehicles"),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_vehicle", ["vehicleId"])
    .index("by_user_vehicle", ["userId", "vehicleId"]),

  // New tables for messaging system
  conversations: defineTable({
    vehicleId: v.optional(v.id("vehicles")),
    renterId: v.string(),
    ownerId: v.string(),
    conversationType: v.optional(
      v.union(
        v.literal("rental"),
        v.literal("team"),
        v.literal("driver"),
        v.literal("coaching"),
        v.literal("seat")
      )
    ),
    teamId: v.optional(v.id("teams")),
    driverProfileId: v.optional(v.id("driverProfiles")),
    coachProfileId: v.optional(v.id("coachProfiles")),
    reservationId: v.optional(v.id("reservations")),
    coachingBookingId: v.optional(v.id("coachingBookings")),
    seatBookingId: v.optional(v.id("seatBookings")),
    lastMessageAt: v.number(),
    lastMessageText: v.optional(v.string()),
    lastMessageSenderId: v.optional(v.string()),
    unreadCountRenter: v.number(),
    unreadCountOwner: v.number(),
    isActive: v.boolean(),
    deletedByRenter: v.optional(v.boolean()),
    deletedByOwner: v.optional(v.boolean()),
    reopenedAtRenter: v.optional(v.number()), // Timestamp when conversation was reopened for renter
    reopenedAtOwner: v.optional(v.number()), // Timestamp when conversation was reopened for owner
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_vehicle", ["vehicleId"])
    .index("by_renter", ["renterId"])
    .index("by_owner", ["ownerId"])
    .index("by_renter_active", ["renterId", "isActive"])
    .index("by_owner_active", ["ownerId", "isActive"])
    .index("by_participants", ["renterId", "ownerId"])
    .index("by_last_message", ["lastMessageAt"])
    .index("by_reservation", ["reservationId"])
    .index("by_coaching_booking", ["coachingBookingId"])
    .index("by_seat_booking", ["seatBookingId"]),

  messages: defineTable({
    conversationId: v.id("conversations"),
    senderId: v.string(),
    content: v.string(),
    messageType: v.union(v.literal("text"), v.literal("image"), v.literal("system")),
    replyTo: v.optional(v.id("messages")),
    attachments: v.optional(
      v.array(
        v.object({
          type: v.union(v.literal("image"), v.literal("pdf")),
          url: v.string(),
          fileName: v.string(),
          fileSize: v.number(),
        })
      )
    ),
    isRead: v.boolean(),
    readAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_sender", ["senderId"])
    .index("by_conversation_created", ["conversationId", "createdAt"])
    .index("by_unread", ["conversationId", "isRead"]),

  // New tables for driver-team matching system
  teams: defineTable({
    ownerId: v.string(),
    name: v.string(),
    description: v.string(),
    logoUrl: v.optional(v.string()),
    /** R2 key for team cover/banner image (Phase 1b). */
    coverImageR2Key: v.optional(v.string()),
    /** Year the team was founded (Phase 1b). */
    foundedYear: v.optional(v.number()),
    /** Team principal name (Phase 1b). */
    principal: v.optional(v.string()),
    /** Sponsor brand list (Phase 1b). */
    sponsors: v.optional(v.array(v.string())),
    logoR2Key: v.optional(v.string()),
    location: v.string(),
    racingType: v.optional(
      v.union(v.literal("real-world"), v.literal("sim-racing"), v.literal("both"))
    ),
    simRacingPlatforms: v.optional(v.array(v.string())),
    specialties: v.array(v.string()), // e.g., ['GT3', 'Formula', 'Endurance', 'iRacing']
    availableSeats: v.number(),
    requirements: v.array(v.string()), // e.g., ['License Required', 'Experience Level']
    contactInfo: v.object({
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
      website: v.optional(v.string()),
    }),
    socialLinks: v.optional(
      v.object({
        instagram: v.optional(v.string()),
        twitter: v.optional(v.string()),
        facebook: v.optional(v.string()),
        linkedin: v.optional(v.string()),
      })
    ),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_active", ["isActive"])
    .index("by_location", ["location"])
    .index("by_racing_type", ["racingType"]),

  driverProfiles: defineTable({
    userId: v.string(),
    avatarUrl: v.optional(v.string()),
    /** R2 key for cover/banner image (Phase 1b). */
    coverImageR2Key: v.optional(v.string()),
    /** R2 key for helmet design (Phase 1b). */
    helmetDesignR2Key: v.optional(v.string()),
    pronouns: v.optional(v.string()),
    /** Free-form career highlights bulleted by the driver (Phase 1b). */
    careerHighlights: v.optional(v.array(v.string())),
    videoReelUrl: v.optional(v.string()),
    headline: v.optional(v.string()),
    bio: v.string(),
    achievements: v.optional(v.string()),
    experience: v.union(
      v.literal("beginner"),
      v.literal("intermediate"),
      v.literal("advanced"),
      v.literal("professional")
    ),
    racingType: v.optional(
      v.union(v.literal("real-world"), v.literal("sim-racing"), v.literal("both"))
    ),
    simRacingPlatforms: v.optional(v.array(v.string())), // e.g., ['iRacing', 'ACC', 'Gran Turismo']
    simRacingRating: v.optional(v.string()), // e.g., 'A License', 'iRating: 3500', 'S Rating'
    licenses: v.array(v.string()), // e.g., ['FIA', 'NASA', 'SCCA']
    preferredCategories: v.array(v.string()), // e.g., ['GT3', 'Formula', 'Endurance', 'iRacing']
    availability: v.array(v.string()), // e.g., ['weekends', 'weekdays', 'evenings']
    location: v.string(),
    contactInfo: v.object({
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
    }),
    socialLinks: v.optional(
      v.object({
        instagram: v.optional(v.string()),
        twitter: v.optional(v.string()),
        linkedin: v.optional(v.string()),
        website: v.optional(v.string()),
      })
    ),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_active", ["isActive"])
    .index("by_location", ["location"])
    .index("by_experience", ["experience"])
    .index("by_racing_type", ["racingType"]),

  teamApplications: defineTable({
    teamId: v.id("teams"),
    driverId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("declined"),
      v.literal("withdrawn")
    ),
    message: v.string(),
    driverExperience: v.string(),
    preferredDates: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_team", ["teamId"])
    .index("by_driver", ["driverId"])
    .index("by_status", ["status"])
    .index("by_team_status", ["teamId", "status"]),

  // New tables for rental completion system
  rentalCompletions: defineTable({
    reservationId: v.id("reservations"),
    vehicleId: v.id("vehicles"),
    renterId: v.string(),
    ownerId: v.string(),
    status: v.union(
      v.literal("pending_renter"),
      v.literal("pending_owner"),
      v.literal("completed"),
      v.literal("disputed")
    ),
    // Renter's return form
    renterReturnForm: v.optional(
      v.object({
        returnDate: v.string(),
        vehicleCondition: v.union(
          v.literal("excellent"),
          v.literal("good"),
          v.literal("fair"),
          v.literal("poor"),
          v.literal("damaged")
        ),
        fuelLevel: v.union(
          v.literal("full"),
          v.literal("3/4"),
          v.literal("1/2"),
          v.literal("1/4"),
          v.literal("empty")
        ),
        mileage: v.number(),
        notes: v.optional(v.string()),
        photos: v.array(v.string()), // URLs to return photos
        submittedAt: v.number(),
      })
    ),
    // Owner's review of return
    ownerReturnReview: v.optional(
      v.object({
        vehicleReceived: v.boolean(),
        conditionMatches: v.boolean(),
        fuelLevelMatches: v.boolean(),
        mileageMatches: v.boolean(),
        damageReported: v.optional(v.string()),
        photos: v.array(v.string()), // URLs to owner photos
        notes: v.optional(v.string()),
        submittedAt: v.number(),
      })
    ),
    // Final completion details
    completionNotes: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_reservation", ["reservationId"])
    .index("by_vehicle", ["vehicleId"])
    .index("by_renter", ["renterId"])
    .index("by_owner", ["ownerId"])
    .index("by_status", ["status"]),

  vehicleVitals: defineTable({
    rentalCompletionId: v.id("rentalCompletions"),
    vehicleId: v.id("vehicles"),
    // Engine vitals
    engineTemp: v.optional(v.number()),
    oilPressure: v.optional(v.number()),
    oilLevel: v.optional(
      v.union(
        v.literal("full"),
        v.literal("3/4"),
        v.literal("1/2"),
        v.literal("1/4"),
        v.literal("low")
      )
    ),
    coolantLevel: v.optional(
      v.union(
        v.literal("full"),
        v.literal("3/4"),
        v.literal("1/2"),
        v.literal("1/4"),
        v.literal("low")
      )
    ),
    // Tire vitals
    tirePressure: v.optional(
      v.object({
        frontLeft: v.optional(v.number()),
        frontRight: v.optional(v.number()),
        rearLeft: v.optional(v.number()),
        rearRight: v.optional(v.number()),
      })
    ),
    tireCondition: v.optional(
      v.union(
        v.literal("excellent"),
        v.literal("good"),
        v.literal("fair"),
        v.literal("poor"),
        v.literal("needs_replacement")
      )
    ),
    // Brake vitals
    brakePadCondition: v.optional(
      v.union(
        v.literal("excellent"),
        v.literal("good"),
        v.literal("fair"),
        v.literal("poor"),
        v.literal("needs_replacement")
      )
    ),
    brakeFluidLevel: v.optional(
      v.union(
        v.literal("full"),
        v.literal("3/4"),
        v.literal("1/2"),
        v.literal("1/4"),
        v.literal("low")
      )
    ),
    // General condition
    bodyCondition: v.optional(
      v.union(
        v.literal("excellent"),
        v.literal("good"),
        v.literal("fair"),
        v.literal("poor"),
        v.literal("damaged")
      )
    ),
    interiorCondition: v.optional(
      v.union(
        v.literal("excellent"),
        v.literal("good"),
        v.literal("fair"),
        v.literal("poor"),
        v.literal("damaged")
      )
    ),
    notes: v.optional(v.string()),
    submittedBy: v.string(), // renterId or ownerId
    submittedAt: v.number(),
  })
    .index("by_rental_completion", ["rentalCompletionId"])
    .index("by_vehicle", ["vehicleId"])
    .index("by_submitter", ["submittedBy"]),

  rentalReviews: defineTable({
    rentalCompletionId: v.id("rentalCompletions"),
    reservationId: v.id("reservations"),
    vehicleId: v.id("vehicles"),
    reviewerId: v.string(), // renterId or ownerId
    reviewedId: v.string(), // the other party's ID
    reviewType: v.union(v.literal("renter_to_owner"), v.literal("owner_to_renter")),
    // Rating (1-5 stars)
    rating: v.number(),
    // Review categories
    communication: v.optional(v.number()), // 1-5
    vehicleCondition: v.optional(v.number()), // 1-5
    professionalism: v.optional(v.number()), // 1-5
    overallExperience: v.optional(v.number()), // 1-5
    // Review text
    title: v.string(),
    review: v.string(),
    // Photos (optional)
    photos: v.optional(v.array(v.string())),
    // Response from reviewed party
    response: v.optional(
      v.object({
        text: v.string(),
        respondedAt: v.number(),
      })
    ),
    // Moderation
    isPublic: v.boolean(),
    isModerated: v.boolean(),
    moderatedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_rental_completion", ["rentalCompletionId"])
    .index("by_reservation", ["reservationId"])
    .index("by_reviewer", ["reviewerId"])
    .index("by_reviewed", ["reviewedId"])
    .index("by_rating", ["rating"])
    .index("by_public", ["isPublic"])
    .index("by_vehicle", ["vehicleId"]),

  // Payment system tables
  payments: defineTable({
    reservationId: v.id("reservations"),
    renterId: v.string(),
    ownerId: v.string(),
    amount: v.number(), // Listing/service total in cents (before card processing)
    platformFee: v.number(), // Renegade platform fee in cents
    ownerAmount: v.number(), // Amount owner receives in cents
    processingFee: v.optional(v.number()), // Estimated Stripe card fee paid by renter (cents)
    currency: v.string(), // 'usd'
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("cancelled"),
      v.literal("refunded"),
      v.literal("partially_refunded")
    ),
    stripePaymentIntentId: v.optional(v.string()),
    stripeCheckoutSessionId: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    stripeChargeId: v.optional(v.string()),
    stripeTransferId: v.optional(v.string()), // For Connect transfers
    stripeAccountId: v.optional(v.string()), // Owner's Connect account ID
    refundAmount: v.optional(v.number()),
    refundPercentage: v.optional(v.number()), // Percentage of original amount refunded (0-100)
    refundPolicy: v.optional(
      v.union(v.literal("full"), v.literal("partial"), v.literal("none"), v.literal("custom"))
    ),
    refundReason: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    metadata: v.optional(
      v.object({
        vehicleId: v.string(),
        startDate: v.string(),
        endDate: v.string(),
        totalDays: v.number(),
      })
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_reservation", ["reservationId"])
    .index("by_renter", ["renterId"])
    .index("by_owner", ["ownerId"])
    .index("by_status", ["status"])
    .index("by_stripe_payment_intent", ["stripePaymentIntentId"])
    .index("by_stripe_checkout_session", ["stripeCheckoutSessionId"])
    .index("by_stripe_customer", ["stripeCustomerId"])
    .index("by_owner_status", ["ownerId", "status"]),

  // Disputes table
  disputes: defineTable({
    completionId: v.id("rentalCompletions"),
    reservationId: v.id("reservations"),
    vehicleId: v.id("vehicles"),
    renterId: v.string(),
    ownerId: v.string(),
    createdBy: v.string(), // renterId or ownerId
    reason: v.string(),
    description: v.string(),
    photos: v.optional(v.array(v.string())),
    requestedResolution: v.optional(v.string()),
    status: v.union(v.literal("open"), v.literal("resolved"), v.literal("closed")),
    // Messages/updates in the dispute
    messages: v.optional(
      v.array(
        v.object({
          id: v.string(),
          senderId: v.string(),
          message: v.string(),
          photos: v.optional(v.array(v.string())),
          createdAt: v.number(),
        })
      )
    ),
    // Resolution details
    resolution: v.optional(v.string()),
    resolutionType: v.optional(
      v.union(
        v.literal("resolved_in_favor_renter"),
        v.literal("resolved_in_favor_owner"),
        v.literal("resolved_compromise"),
        v.literal("dismissed")
      )
    ),
    resolvedAt: v.optional(v.number()),
    resolvedBy: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_completion", ["completionId"])
    .index("by_reservation", ["reservationId"])
    .index("by_vehicle", ["vehicleId"])
    .index("by_renter", ["renterId"])
    .index("by_owner", ["ownerId"])
    .index("by_status", ["status"])
    .index("by_created_by", ["createdBy"]),

  // Damage invoices - post-rental damage claims
  damageInvoices: defineTable({
    reservationId: v.id("reservations"),
    completionId: v.id("rentalCompletions"),
    vehicleId: v.id("vehicles"),
    renterId: v.string(),
    ownerId: v.string(),
    amount: v.number(), // cents
    description: v.string(),
    photos: v.array(v.string()), // R2 keys
    status: v.union(
      v.literal("pending_review"),
      v.literal("payment_pending"),
      v.literal("paid"),
      v.literal("rejected"),
      v.literal("cancelled")
    ),
    // Admin
    adminReviewedBy: v.optional(v.string()),
    adminReviewedAt: v.optional(v.number()),
    adminNotes: v.optional(v.string()),
    // Stripe (populated on approval)
    stripeCheckoutSessionId: v.optional(v.string()),
    stripeCheckoutUrl: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
    stripeChargeId: v.optional(v.string()),
    // Linked dispute (optional)
    disputeId: v.optional(v.id("disputes")),
    paidAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_reservation", ["reservationId"])
    .index("by_completion", ["completionId"])
    .index("by_renter", ["renterId"])
    .index("by_owner", ["ownerId"])
    .index("by_status", ["status"])
    .index("by_stripe_checkout_session", ["stripeCheckoutSessionId"])
    .index("by_stripe_payment_intent", ["stripePaymentIntentId"]),

  // Audit logs for tracking state changes
  auditLogs: defineTable({
    entityType: v.union(
      v.literal("reservation"),
      v.literal("payment"),
      v.literal("user"),
      v.literal("vehicle"),
      v.literal("dispute"),
      v.literal("damage_invoice"),
      v.literal("invoice"),
      v.literal("coach_profile"),
      v.literal("coaching_booking"),
      v.literal("coaching_review"),
      v.literal("race_series"),
      v.literal("race_event"),
      v.literal("team_car"),
      v.literal("seat_offering"),
      v.literal("seat_booking")
    ),
    entityId: v.string(), // ID of the entity being changed
    action: v.string(), // e.g., "status_change", "create", "update", "delete"
    userId: v.optional(v.string()), // User who performed the action (null for system actions)
    previousState: v.optional(v.any()), // Previous state snapshot
    newState: v.optional(v.any()), // New state snapshot
    metadata: v.optional(v.any()), // Additional context
    timestamp: v.number(),
  })
    .index("by_entity", ["entityType", "entityId"])
    .index("by_user", ["userId"])
    .index("by_timestamp", ["timestamp"])
    .index("by_action", ["action"]),

  // Platform settings for fees and configuration
  platformSettings: defineTable({
    platformFeePercentage: v.number(), // e.g., 5 for 5%
    // Deprecated: kept optional for existing documents; no longer applied
    minimumPlatformFee: v.optional(v.number()),
    maximumPlatformFee: v.optional(v.number()),
    // Early adopter promo: new signups in [startsAt, endsAt] get fee cap
    earlyAdopterPromoStartsAt: v.optional(v.number()),
    earlyAdopterPromoEndsAt: v.optional(v.number()),
    earlyAdopterFeeCapPercentage: v.optional(v.number()), // default 3
    stripeAccountId: v.optional(v.string()), // Main platform account
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_active", ["isActive"]),

  // Notifications
  notifications: defineTable({
    userId: v.string(),
    type: v.union(
      v.literal("reservation_approved"),
      v.literal("reservation_declined"),
      v.literal("reservation_cancelled"),
      v.literal("reservation_completed"),
      v.literal("new_message"),
      v.literal("payment_success"),
      v.literal("payment_failed"),
      v.literal("dispute_update"),
      v.literal("review_received"),
      v.literal("system"),
      v.literal("team_application"),
      v.literal("connection_request"),
      v.literal("application_status_change"),
      v.literal("endorsement_received"),
      v.literal("team_event"),
      v.literal("profile_view"),
      v.literal("damage_invoice"),
      v.literal("invoice"),
      v.literal("coaching_request_pending"),
      v.literal("coaching_approved"),
      v.literal("coaching_declined"),
      v.literal("coaching_cancelled"),
      v.literal("coaching_completed"),
      v.literal("seat_request_pending"),
      v.literal("seat_approved"),
      v.literal("seat_declined"),
      v.literal("seat_cancelled"),
      v.literal("seat_waitlisted"),
      v.literal("seat_spot_available"),
      v.literal("seat_completed")
    ),
    title: v.string(),
    message: v.string(),
    isRead: v.boolean(),
    link: v.optional(v.string()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_read", ["userId", "isRead"])
    .index("by_user_created", ["userId", "createdAt"]),

  // Reports
  reports: defineTable({
    reporterId: v.string(),
    reportedUserId: v.optional(v.string()),
    reportedVehicleId: v.optional(v.id("vehicles")),
    reportedReviewId: v.optional(v.id("rentalReviews")),
    reason: v.union(
      v.literal("inappropriate_content"),
      v.literal("fraud"),
      v.literal("safety_concern"),
      v.literal("harassment"),
      v.literal("spam"),
      v.literal("other")
    ),
    description: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("reviewed"),
      v.literal("resolved"),
      v.literal("dismissed")
    ),
    adminNotes: v.optional(v.string()),
    resolvedAt: v.optional(v.number()),
    resolvedBy: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_reporter", ["reporterId"])
    .index("by_status", ["status"])
    .index("by_reported_user", ["reportedUserId"]),

  // User blocks
  userBlocks: defineTable({
    blockerId: v.string(),
    blockedUserId: v.string(),
    createdAt: v.number(),
  })
    .index("by_blocker", ["blockerId"])
    .index("by_blocked", ["blockedUserId"])
    .index("by_blocker_blocked", ["blockerId", "blockedUserId"]),

  // Motorsports networking tables
  teamDriverConnections: defineTable({
    teamId: v.id("teams"),
    driverProfileId: v.id("driverProfiles"),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("declined")),
    message: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_team", ["teamId"])
    .index("by_driver", ["driverProfileId"])
    .index("by_team_driver", ["teamId", "driverProfileId"])
    .index("by_status", ["status"]),

  teamMembers: defineTable({
    teamId: v.id("teams"),
    driverProfileId: v.optional(v.id("driverProfiles")),
    userId: v.string(),
    role: v.union(v.literal("owner"), v.literal("driver"), v.literal("crew"), v.literal("manager")),
    joinedAt: v.number(),
    status: v.union(v.literal("active"), v.literal("inactive")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_team", ["teamId"])
    .index("by_user", ["userId"])
    .index("by_team_user", ["teamId", "userId"])
    .index("by_team_status", ["teamId", "status"]),

  teamEvents: defineTable({
    teamId: v.id("teams"),
    title: v.string(),
    description: v.optional(v.string()),
    date: v.string(),
    endDate: v.optional(v.string()),
    time: v.optional(v.string()),
    location: v.optional(v.string()),
    type: v.union(
      v.literal("race"),
      v.literal("practice"),
      v.literal("meeting"),
      v.literal("social"),
      v.literal("other")
    ),
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_team", ["teamId"])
    .index("by_date", ["date"])
    .index("by_team_date", ["teamId", "date"]),

  eventRsvps: defineTable({
    eventId: v.id("teamEvents"),
    userId: v.string(),
    status: v.union(v.literal("going"), v.literal("maybe"), v.literal("not_going")),
    createdAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_user", ["userId"])
    .index("by_event_user", ["eventId", "userId"]),

  driverMedia: defineTable({
    driverProfileId: v.id("driverProfiles"),
    url: v.string(),
    r2Key: v.optional(v.string()),
    type: v.union(v.literal("image"), v.literal("video")),
    caption: v.optional(v.string()),
    order: v.number(),
    createdAt: v.number(),
  })
    .index("by_driver", ["driverProfileId"])
    .index("by_driver_order", ["driverProfileId", "order"]),

  endorsements: defineTable({
    driverProfileId: v.id("driverProfiles"),
    endorserId: v.string(),
    type: v.union(
      v.literal("racecraft"),
      v.literal("consistency"),
      v.literal("qualifying_pace"),
      v.literal("teamwork"),
      v.literal("communication")
    ),
    message: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_driver", ["driverProfileId"])
    .index("by_endorser", ["endorserId"])
    .index("by_driver_endorser", ["driverProfileId", "endorserId"]),

  profileViews: defineTable({
    profileId: v.string(),
    profileType: v.union(v.literal("driver"), v.literal("team")),
    viewerId: v.optional(v.string()),
    viewedAt: v.number(),
  })
    .index("by_profile", ["profileId", "profileType"])
    .index("by_viewer", ["viewerId"])
    .index("by_profile_viewer", ["profileId", "profileType", "viewerId"]),

  presence: defineTable({
    conversationId: v.id("conversations"),
    userId: v.string(),
    isTyping: v.boolean(),
    lastSeen: v.number(),
    updatedAt: v.number(),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_user", ["userId"])
    .index("by_conversation_user", ["conversationId", "userId"]),

  messageTemplates: defineTable({
    userId: v.optional(v.string()),
    label: v.string(),
    content: v.string(),
    category: v.union(v.literal("inquiry"), v.literal("response"), v.literal("logistics")),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_category", ["category"])
    .index("by_user_category", ["userId", "category"]),

  // ============================================================
  // Paddock — social feed (Phase 1a)
  // ============================================================

  /** Posts authored by users (text + optional media + optional location/track tag). */
  posts: defineTable({
    authorId: v.string(),
    /** Posting on behalf of a team (or null = personal). */
    teamId: v.optional(v.id("teams")),
    content: v.string(),
    /** Optional structured tags surfaced in the feed. */
    trackId: v.optional(v.id("tracks")),
    vehicleId: v.optional(v.id("vehicles")),
    /** R2 keys for attached media. */
    mediaR2Keys: v.optional(v.array(v.string())),
    mediaType: v.optional(v.union(v.literal("image"), v.literal("video"), v.literal("mixed"))),
    /** Featured boost (Phase 3). */
    featuredUntil: v.optional(v.number()),
    /** Cached counters for fast feed rendering. */
    reactionCount: v.optional(v.number()),
    commentCount: v.optional(v.number()),
    /** Soft delete. */
    isDeleted: v.optional(v.boolean()),
    deletedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_author", ["authorId"])
    .index("by_team", ["teamId"])
    .index("by_track", ["trackId"])
    .index("by_created", ["createdAt"])
    .index("by_featured", ["featuredUntil"])
    .index("by_author_created", ["authorId", "createdAt"]),

  postReactions: defineTable({
    postId: v.id("posts"),
    userId: v.string(),
    type: v.union(
      v.literal("like"),
      v.literal("fire"),
      v.literal("checkered"),
      v.literal("clap"),
      v.literal("respect")
    ),
    createdAt: v.number(),
  })
    .index("by_post", ["postId"])
    .index("by_user", ["userId"])
    .index("by_post_user", ["postId", "userId"]),

  postComments: defineTable({
    postId: v.id("posts"),
    authorId: v.string(),
    content: v.string(),
    /** Reply threading. */
    parentCommentId: v.optional(v.id("postComments")),
    isDeleted: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_post", ["postId"])
    .index("by_author", ["authorId"])
    .index("by_post_created", ["postId", "createdAt"]),

  /** Bidirectional follows: user → user, user → team. Profile follows handled via the target user. */
  follows: defineTable({
    followerId: v.string(),
    followedUserId: v.optional(v.string()),
    followedTeamId: v.optional(v.id("teams")),
    createdAt: v.number(),
  })
    .index("by_follower", ["followerId"])
    .index("by_followed_user", ["followedUserId"])
    .index("by_followed_team", ["followedTeamId"])
    .index("by_follower_user", ["followerId", "followedUserId"])
    .index("by_follower_team", ["followerId", "followedTeamId"]),

  /** System-generated activity events that flow into the Paddock feed. */
  activityEvents: defineTable({
    actorId: v.string(),
    type: v.union(
      v.literal("driver_joined_team"),
      v.literal("driver_endorsed"),
      v.literal("team_event_created"),
      v.literal("coach_listing_created"),
      v.literal("vehicle_listed"),
      v.literal("race_result_posted"),
      v.literal("user_verified"),
      v.literal("post_created")
    ),
    /** Optional link target for the activity card. */
    targetType: v.optional(
      v.union(
        v.literal("user"),
        v.literal("team"),
        v.literal("vehicle"),
        v.literal("post"),
        v.literal("race_result"),
        v.literal("coach_service"),
        v.literal("team_event")
      )
    ),
    targetId: v.optional(v.string()),
    /** Free-form payload for rendering specifics. */
    metadata: v.optional(v.any()),
    /** Visibility — `public` shows in global feed, `followers` shows only to followers. */
    visibility: v.union(v.literal("public"), v.literal("followers")),
    createdAt: v.number(),
  })
    .index("by_actor", ["actorId"])
    .index("by_created", ["createdAt"])
    .index("by_actor_created", ["actorId", "createdAt"])
    .index("by_visibility_created", ["visibility", "createdAt"]),

  // ============================================================
  // Universal invoices (Phase 1c) — supersedes coachInvoices + damageInvoices
  // ============================================================

  invoices: defineTable({
    senderId: v.string(),
    recipientId: v.string(),
    /** Optional team that issued the invoice. */
    senderTeamId: v.optional(v.id("teams")),
    title: v.string(),
    description: v.optional(v.string()),
    /** Line items in cents. */
    lineItems: v.array(
      v.object({
        description: v.string(),
        quantity: v.number(),
        unitAmount: v.number(),
        amount: v.number(),
      })
    ),
    /** Totals in cents. */
    subtotal: v.number(),
    taxAmount: v.optional(v.number()),
    discountAmount: v.optional(v.number()),
    total: v.number(),
    currency: v.string(),
    /** Allowed payment methods on the checkout. */
    paymentMethods: v.array(
      v.union(v.literal("stripe_card"), v.literal("stripe_ach"), v.literal("external"))
    ),
    /** Optional related entity for context. */
    relatedEntity: v.optional(
      v.object({
        type: v.union(
          v.literal("vehicle"),
          v.literal("rental"),
          v.literal("coaching"),
          v.literal("damage"),
          v.literal("contract"),
          v.literal("sponsorship"),
          v.literal("other")
        ),
        id: v.string(),
      })
    ),
    /** Optional document attached for e-sign (Phase 1d). */
    documentId: v.optional(v.id("documents")),
    /** Vehicle whose owner-defined damage deposit applies when paying by ACH/debit. */
    depositVehicleId: v.optional(v.id("vehicles")),
    /** Stripe + checkout state. */
    stripeInvoiceId: v.optional(v.string()),
    stripeCheckoutSessionId: v.optional(v.string()),
    stripeCheckoutUrl: v.optional(v.string()),
    stripeInvoicePdf: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
    stripeChargeId: v.optional(v.string()),
    selectedPaymentMethod: v.optional(
      v.union(v.literal("stripe_card"), v.literal("stripe_ach"), v.literal("external"))
    ),
    amountDue: v.optional(v.number()),
    /** Snapshot of Renegade platform fee in cents (not the card processing pass-through). */
    platformFee: v.optional(v.number()),
    /** Estimated Stripe card fee paid by the payer, in cents. ACH payments store 0. */
    processingFee: v.optional(v.number()),
    /** Sender → owner of money received (in cents, after platform fee, including any deposit). */
    senderAmount: v.optional(v.number()),
    damageDepositAmount: v.optional(v.number()),
    depositStatus: v.optional(
      v.union(
        v.literal("not_required"),
        v.literal("pending"),
        v.literal("held"),
        v.literal("partially_refunded"),
        v.literal("refunded"),
        v.literal("applied")
      )
    ),
    depositRefundAmount: v.optional(v.number()),
    depositRefundReason: v.optional(v.string()),
    stripeDepositRefundId: v.optional(v.string()),
    depositRefundedAt: v.optional(v.number()),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("viewed"),
      v.literal("payment_pending"),
      v.literal("processing"),
      v.literal("paid"),
      v.literal("overdue"),
      v.literal("cancelled"),
      v.literal("refunded")
    ),
    dueDate: v.optional(v.string()),
    paidAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    viewedAt: v.optional(v.number()),
    /** Source legacy table during migration window (Phase 1c). */
    legacySource: v.optional(v.union(v.literal("coachInvoices"), v.literal("damageInvoices"))),
    legacyId: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_sender", ["senderId"])
    .index("by_recipient", ["recipientId"])
    .index("by_status", ["status"])
    .index("by_sender_status", ["senderId", "status"])
    .index("by_recipient_status", ["recipientId", "status"])
    .index("by_stripe_checkout_session", ["stripeCheckoutSessionId"])
    .index("by_stripe_payment_intent", ["stripePaymentIntentId"])
    .index("by_legacy", ["legacySource", "legacyId"]),

  // ============================================================
  // E-signature documents (Phase 1d)
  // ============================================================

  /** A document template (e.g. Standard Coaching Agreement). */
  documentTemplates: defineTable({
    name: v.string(),
    category: v.union(
      v.literal("rental_agreement"),
      v.literal("coaching_agreement"),
      v.literal("driver_team_contract"),
      v.literal("nda"),
      v.literal("sponsorship_mou"),
      v.literal("custom")
    ),
    /** Markdown body with `{{placeholder}}` tokens. */
    bodyMarkdown: v.string(),
    /** Placeholder names the template expects to be filled. */
    placeholders: v.array(v.string()),
    isActive: v.boolean(),
    /** Owner: null = global/system template. */
    ownerId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_category", ["category"])
    .index("by_owner", ["ownerId"])
    .index("by_active", ["isActive"]),

  /** A document instance — created from a template, sent to one or more signers. */
  documents: defineTable({
    templateId: v.optional(v.id("documentTemplates")),
    title: v.string(),
    /** Resolved markdown after placeholder substitution. */
    bodyMarkdown: v.string(),
    /** Optional rendered PDF stored in R2. */
    renderedPdfR2Key: v.optional(v.string()),
    senderId: v.string(),
    /** Required signers (ordered). */
    signers: v.array(
      v.object({
        userId: v.string(),
        name: v.string(),
        email: v.string(),
        order: v.number(),
      })
    ),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("partially_signed"),
      v.literal("completed"),
      v.literal("voided"),
      v.literal("expired")
    ),
    /** External provider ID when using Documenso/Dropbox Sign (Phase 1d v2). */
    externalProvider: v.optional(v.union(v.literal("documenso"), v.literal("dropbox_sign"))),
    externalDocumentId: v.optional(v.string()),
    /** Linked entities for navigation. */
    relatedEntity: v.optional(
      v.object({
        type: v.union(
          v.literal("invoice"),
          v.literal("team_application"),
          v.literal("reservation"),
          v.literal("coach_booking")
        ),
        id: v.string(),
      })
    ),
    sentAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    voidedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_sender", ["senderId"])
    .index("by_status", ["status"])
    .index("by_sender_status", ["senderId", "status"])
    .index("by_external", ["externalProvider", "externalDocumentId"]),

  documentSignatures: defineTable({
    documentId: v.id("documents"),
    signerUserId: v.string(),
    signerName: v.string(),
    signerEmail: v.string(),
    /** R2 key of typed/drawn signature image. */
    signatureImageR2Key: v.optional(v.string()),
    /** Typed name acceptance. */
    typedSignature: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("signed"), v.literal("declined")),
    signedAt: v.optional(v.number()),
    declinedAt: v.optional(v.number()),
    declinedReason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_document", ["documentId"])
    .index("by_signer", ["signerUserId"])
    .index("by_document_signer", ["documentId", "signerUserId"]),

  // ============================================================
  // Race data (Phase 2a — race-monitor; Phase 2b — iRacing)
  // ============================================================

  /** A race-monitor (or imported) race event. */
  raceEvents: defineTable({
    /** External event ID from race-monitor. */
    raceMonitorEventId: v.optional(v.string()),
    name: v.string(),
    series: v.optional(v.string()),
    trackId: v.optional(v.id("tracks")),
    trackName: v.optional(v.string()),
    location: v.optional(v.string()),
    startDate: v.string(),
    endDate: v.optional(v.string()),
    source: v.union(v.literal("race_monitor"), v.literal("manual"), v.literal("iracing")),
    isVerified: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_race_monitor", ["raceMonitorEventId"])
    .index("by_track", ["trackId"])
    .index("by_start_date", ["startDate"])
    .index("by_source", ["source"]),

  /** A driver/team result at a race event. */
  raceResults: defineTable({
    eventId: v.id("raceEvents"),
    /** Either a Renegade driverProfileId (claimed result) or a free-form competitor name. */
    driverProfileId: v.optional(v.id("driverProfiles")),
    teamId: v.optional(v.id("teams")),
    competitorName: v.string(),
    /** External competitor ID from race-monitor. */
    raceMonitorCompetitorId: v.optional(v.string()),
    classId: v.optional(v.string()),
    className: v.optional(v.string()),
    carNumber: v.optional(v.string()),
    carModel: v.optional(v.string()),
    /** Position in class (1-based). */
    classPosition: v.optional(v.number()),
    /** Overall finishing position (1-based). */
    overallPosition: v.optional(v.number()),
    bestLapTimeMs: v.optional(v.number()),
    totalTimeMs: v.optional(v.number()),
    laps: v.optional(v.number()),
    status: v.optional(v.string()),
    /** Verified = data pulled from race-monitor; user-claimed link still requires admin verification. */
    isVerified: v.boolean(),
    /** Claim provenance. */
    claimedByUserId: v.optional(v.string()),
    claimedAt: v.optional(v.number()),
    verifiedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_driver_profile", ["driverProfileId"])
    .index("by_team", ["teamId"])
    .index("by_competitor", ["raceMonitorCompetitorId"])
    .index("by_event_competitor", ["eventId", "raceMonitorCompetitorId"]),

  /** Per-driver iRacing snapshot, refreshed by cron. */
  iracingProfiles: defineTable({
    /** Renegade user ID (Clerk externalId). */
    userId: v.string(),
    driverProfileId: v.optional(v.id("driverProfiles")),
    iracingCustId: v.string(),
    displayName: v.optional(v.string()),
    /** Latest snapshot. */
    irating: v.optional(v.number()),
    /** Safety rating as the float (e.g. 3.42) plus license letter. */
    safetyRating: v.optional(v.number()),
    licenseClass: v.optional(
      v.union(
        v.literal("R"),
        v.literal("D"),
        v.literal("C"),
        v.literal("B"),
        v.literal("A"),
        v.literal("P")
      )
    ),
    /** OAuth refresh token (encrypted at rest by Convex env). */
    refreshTokenCipher: v.optional(v.string()),
    /** Whether the user has authorized iRacing OAuth. */
    isConnected: v.boolean(),
    lastSyncedAt: v.optional(v.number()),
    syncErrorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_iracing_cust", ["iracingCustId"])
    .index("by_driver_profile", ["driverProfileId"]),

  // ============================================================
  // Subscriptions + featured listings (Phase 3)
  // ============================================================

  subscriptions: defineTable({
    userId: v.string(),
    /** Optional team subscription. */
    teamId: v.optional(v.id("teams")),
    tier: v.union(v.literal("driver_pro"), v.literal("team_pro"), v.literal("team_elite")),
    status: v.union(
      v.literal("trialing"),
      v.literal("active"),
      v.literal("past_due"),
      v.literal("canceled"),
      v.literal("incomplete")
    ),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    cancelAtPeriodEnd: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_team", ["teamId"])
    .index("by_stripe_subscription", ["stripeSubscriptionId"])
    .index("by_stripe_customer", ["stripeCustomerId"])
    .index("by_status", ["status"]),

  /** Featured listing boost — paid promotion in feed/search. */
  featuredBoosts: defineTable({
    purchaserId: v.string(),
    targetType: v.union(
      v.literal("driver"),
      v.literal("team"),
      v.literal("vehicle"),
      v.literal("coach_service"),
      v.literal("post")
    ),
    targetId: v.string(),
    startsAt: v.number(),
    endsAt: v.number(),
    amountCents: v.number(),
    stripePaymentIntentId: v.optional(v.string()),
    status: v.union(
      v.literal("payment_pending"),
      v.literal("active"),
      v.literal("expired"),
      v.literal("cancelled")
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_purchaser", ["purchaserId"])
    .index("by_target", ["targetType", "targetId"])
    .index("by_status_endsAt", ["status", "endsAt"])
    .index("by_status", ["status"]),

  // ============================================================
  // Phase 4 — verified badges, referrals, sponsor profiles
  // ============================================================

  verifications: defineTable({
    userId: v.string(),
    type: v.union(
      v.literal("identity"),
      v.literal("race_monitor"),
      v.literal("iracing"),
      v.literal("team_principal"),
      v.literal("sponsor_brand")
    ),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    evidenceR2Keys: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    reviewedBy: v.optional(v.string()),
    reviewedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_type", ["userId", "type"])
    .index("by_status", ["status"]),

  referrals: defineTable({
    referrerId: v.string(),
    /** Either an inviter URL code or a recipient user ID once they sign up. */
    code: v.string(),
    invitedEmail: v.optional(v.string()),
    invitedUserId: v.optional(v.string()),
    /** Cents earned by the referrer; rev-share applied at qualifying event. */
    earnedCents: v.optional(v.number()),
    status: v.union(
      v.literal("pending"),
      v.literal("signed_up"),
      v.literal("qualified"),
      v.literal("expired")
    ),
    qualifiedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_referrer", ["referrerId"])
    .index("by_code", ["code"])
    .index("by_invited_user", ["invitedUserId"])
    .index("by_status", ["status"]),

  sponsorProfiles: defineTable({
    userId: v.string(),
    brandName: v.string(),
    description: v.optional(v.string()),
    logoR2Key: v.optional(v.string()),
    website: v.optional(v.string()),
    industry: v.optional(v.string()),
    isVerified: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_brand", ["brandName"])
    .index("by_verified", ["isVerified"]),
  coachProfiles: defineTable({
    userId: v.string(),
    headline: v.optional(v.string()),
    bio: v.string(),
    avatarUrl: v.optional(v.string()),
    avatarR2Key: v.optional(v.string()),
    yearsExperience: v.optional(v.number()),
    specialties: v.array(v.string()), // e.g., ['HPDE', 'GT3', 'Karting', 'Time Attack']
    certifications: v.optional(v.array(v.string())), // e.g., ['SCCA Licensed Instructor', 'NASA HPDE-4']
    tracksCoachedAt: v.optional(v.array(v.string())), // free-text track names for v1
    racingType: v.optional(
      v.union(v.literal("real-world"), v.literal("sim-racing"), v.literal("both"))
    ),
    // Pricing in cents. At least one must be set, validated in mutations.
    hourlyRate: v.optional(v.number()),
    halfDayRate: v.optional(v.number()),
    fullDayRate: v.optional(v.number()),
    location: v.string(),
    contactInfo: v.optional(
      v.object({
        phone: v.optional(v.string()),
        email: v.optional(v.string()),
      })
    ),
    socialLinks: v.optional(
      v.object({
        instagram: v.optional(v.string()),
        twitter: v.optional(v.string()),
        linkedin: v.optional(v.string()),
        website: v.optional(v.string()),
      })
    ),
    isActive: v.boolean(),
    viewCount: v.optional(v.number()),
    // Aggregate rating derived from public coachingReviews (recalculated on submit)
    rating: v.optional(v.number()),
    reviewCount: v.optional(v.number()),
    // Soft vetting: coaches publish immediately as "pending"; admins verify/reject.
    // The public directory still lists active profiles; "verified" drives a badge.
    verificationStatus: v.optional(
      v.union(v.literal("pending"), v.literal("verified"), v.literal("rejected"))
    ),
    verifiedAt: v.optional(v.number()),
    verifiedBy: v.optional(v.string()),
    moderationNotes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_active", ["isActive"])
    .index("by_location", ["location"])
    .index("by_racing_type", ["racingType"])
    .index("by_verification_status", ["verificationStatus"]),

  coachingReviews: defineTable({
    coachingBookingId: v.id("coachingBookings"),
    coachProfileId: v.id("coachProfiles"),
    coachUserId: v.string(),
    reviewerId: v.string(), // the renter who took the session
    rating: v.number(), // 1-5 overall
    // Optional per-category scores (1-5)
    communication: v.optional(v.number()),
    knowledge: v.optional(v.number()),
    value: v.optional(v.number()),
    title: v.string(),
    review: v.string(),
    photos: v.optional(v.array(v.string())),
    response: v.optional(
      v.object({
        text: v.string(),
        respondedAt: v.number(),
      })
    ),
    isPublic: v.boolean(),
    isModerated: v.boolean(),
    moderatedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_booking", ["coachingBookingId"])
    .index("by_coach_profile", ["coachProfileId"])
    .index("by_reviewer", ["reviewerId"])
    .index("by_public", ["isPublic"])
    .index("by_moderated", ["isModerated"]),

  coachAvailability: defineTable({
    coachProfileId: v.id("coachProfiles"),
    date: v.string(), // YYYY-MM-DD
    isAvailable: v.boolean(),
    reason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_coach_date", ["coachProfileId", "date"])
    .index("by_coach_available", ["coachProfileId", "isAvailable"]),

  coachingBookings: defineTable({
    coachProfileId: v.id("coachProfiles"),
    coachUserId: v.string(),
    renterId: v.string(),
    startDate: v.string(), // YYYY-MM-DD
    endDate: v.string(), // YYYY-MM-DD (same as startDate for single-day hourly bookings)
    startTime: v.optional(v.string()), // HH:MM 24-hour, required for hourly
    endTime: v.optional(v.string()),
    sessionType: v.union(v.literal("hourly"), v.literal("half_day"), v.literal("full_day")),
    hours: v.optional(v.number()), // populated when sessionType === "hourly"
    totalDays: v.number(),
    rate: v.number(), // unit rate in cents at time of booking (hourlyRate/halfDayRate/fullDayRate)
    totalAmount: v.number(), // cents
    // Optional free-text event tag (e.g. "COTA SCCA weekend, March 14")
    eventName: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("confirmed"),
      v.literal("cancelled"),
      v.literal("completed"),
      v.literal("declined"),
      v.literal("expired")
    ),
    approvedAt: v.optional(v.number()),
    renterMessage: v.optional(v.string()),
    coachMessage: v.optional(v.string()),
    cancellationReason: v.optional(v.string()),
    paymentId: v.optional(v.id("payments")),
    paymentStatus: v.optional(
      v.union(v.literal("pending"), v.literal("paid"), v.literal("failed"), v.literal("refunded"))
    ),
    stripeCheckoutSessionId: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
    confirmedAt: v.optional(v.number()),
    // Lightweight dispute flag: either party can "report a problem" on a
    // confirmed/completed booking, surfacing it to admins for refund/dismissal.
    disputeStatus: v.optional(
      v.union(v.literal("open"), v.literal("resolved"), v.literal("dismissed"))
    ),
    issueReportedAt: v.optional(v.number()),
    issueReportedBy: v.optional(v.string()),
    issueReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_coach_profile", ["coachProfileId"])
    .index("by_coach_user", ["coachUserId"])
    .index("by_renter", ["renterId"])
    .index("by_status", ["status"])
    .index("by_coach_user_status", ["coachUserId", "status"])
    .index("by_renter_status", ["renterId", "status"])
    .index("by_dates", ["startDate", "endDate"])
    .index("by_dispute_status", ["disputeStatus"])
    .index("by_stripe_checkout_session", ["stripeCheckoutSessionId"])
    .index("by_stripe_payment_intent", ["stripePaymentIntentId"]),

  // Endurance seat rentals: RaceSeries → RaceEvent → TeamCar → SeatOffering → SeatBooking.
  // Parallel to coaching (not vehicles/reservations). Stripe IDs live on seatBookings.
  // Request opens an in-app seat conversation immediately; public listings omit contact.
  raceSeries: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    organizer: v.optional(v.string()),
    website: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    isActive: v.boolean(),
    // Public team pages hide this series' reliability stats when false.
    // Missing means shown (existing series stay public).
    showPublicResults: v.optional(v.boolean()),
    // Optional override of DEFAULT_DNF_LAP_FRACTION (0–1). Missing uses 0.7.
    dnfLapThreshold: v.optional(v.number()),
    createdByUserId: v.string(),
    createdByTeamId: v.optional(v.id("teams")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_active", ["isActive"])
    .index("by_created_by_user", ["createdByUserId"])
    .index("by_created_by_team", ["createdByTeamId"]),

  raceEvents: defineTable({
    seriesId: v.id("raceSeries"),
    name: v.string(),
    description: v.optional(v.string()),
    startDate: v.string(), // YYYY-MM-DD
    endDate: v.string(), // YYYY-MM-DD
    trackId: v.optional(v.id("tracks")),
    trackName: v.optional(v.string()), // free-text fallback when no catalog track
    trackLocation: v.optional(v.string()),
    eventUrl: v.optional(v.string()),
    isActive: v.boolean(),
    createdByUserId: v.string(),
    createdByTeamId: v.optional(v.id("teams")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_series", ["seriesId"])
    .index("by_series_active", ["seriesId", "isActive"])
    .index("by_active", ["isActive"])
    .index("by_start_date", ["startDate"])
    .index("by_track", ["trackId"])
    .index("by_created_by_user", ["createdByUserId"])
    .index("by_created_by_team", ["createdByTeamId"]),

  teamCars: defineTable({
    teamId: v.id("teams"),
    raceEventId: v.id("raceEvents"),
    // Stripe Connect payouts go to this user (typically the team owner).
    hostUserId: v.string(),
    carNumber: v.optional(v.string()),
    carClass: v.optional(v.string()), // e.g. GT4, TCR, LMP3
    make: v.string(),
    model: v.string(),
    year: v.optional(v.number()),
    description: v.optional(v.string()),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_team", ["teamId"])
    .index("by_event", ["raceEventId"])
    .index("by_team_event", ["teamId", "raceEventId"])
    .index("by_host", ["hostUserId"])
    .index("by_event_active", ["raceEventId", "isActive"]),

  seatOfferings: defineTable({
    teamCarId: v.id("teamCars"),
    raceEventId: v.id("raceEvents"),
    teamId: v.id("teams"),
    hostUserId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    spotCount: v.number(), // N countable seats; never trust client remaining
    priceCents: v.number(), // full seat price at listing time
    depositCents: v.number(),
    experienceLevel: v.optional(
      v.union(
        v.literal("beginner"),
        v.literal("intermediate"),
        v.literal("advanced"),
        v.literal("professional")
      )
    ),
    stintNotes: v.optional(v.string()),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_team_car", ["teamCarId"])
    .index("by_event", ["raceEventId"])
    .index("by_team", ["teamId"])
    .index("by_host", ["hostUserId"])
    .index("by_event_active", ["raceEventId", "isActive"])
    .index("by_team_active", ["teamId", "isActive"]),

  seatBookings: defineTable({
    seatOfferingId: v.id("seatOfferings"),
    teamCarId: v.id("teamCars"),
    raceEventId: v.id("raceEvents"),
    teamId: v.id("teams"),
    hostUserId: v.string(),
    driverId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("waitlisted"),
      v.literal("approved"),
      v.literal("deposit_paid"),
      v.literal("confirmed"),
      v.literal("cancelled"),
      v.literal("declined"),
      v.literal("expired"),
      v.literal("completed")
    ),
    // Snapshotted at request time — later listing edits do not change this booking.
    priceCents: v.number(),
    depositCents: v.number(),
    balanceCents: v.number(),
    platformFeePercentage: v.number(),
    availableStartDate: v.string(),
    availableEndDate: v.string(),
    driverExperience: v.union(
      v.literal("beginner"),
      v.literal("intermediate"),
      v.literal("advanced"),
      v.literal("professional")
    ),
    budgetBand: v.string(),
    seriesClass: v.string(),
    whyBuying: v.string(),
    driverMessage: v.optional(v.string()),
    teamMessage: v.optional(v.string()),
    cancellationReason: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    waitlistedAt: v.optional(v.number()),
    depositPaidAt: v.optional(v.number()),
    confirmedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    // Stripe Checkout state lives on this row (not payments.reservationId).
    depositPaymentStatus: v.optional(
      v.union(v.literal("pending"), v.literal("paid"), v.literal("failed"), v.literal("refunded"))
    ),
    balancePaymentStatus: v.optional(
      v.union(v.literal("pending"), v.literal("paid"), v.literal("failed"), v.literal("refunded"))
    ),
    stripeDepositCheckoutSessionId: v.optional(v.string()),
    stripeDepositPaymentIntentId: v.optional(v.string()),
    stripeBalanceCheckoutSessionId: v.optional(v.string()),
    stripeBalancePaymentIntentId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_offering", ["seatOfferingId"])
    .index("by_offering_status", ["seatOfferingId", "status"])
    .index("by_driver", ["driverId"])
    .index("by_driver_status", ["driverId", "status"])
    .index("by_driver_offering", ["driverId", "seatOfferingId"])
    .index("by_host", ["hostUserId"])
    .index("by_host_status", ["hostUserId", "status"])
    .index("by_team", ["teamId"])
    .index("by_event", ["raceEventId"])
    .index("by_status", ["status"])
    .index("by_stripe_deposit_checkout_session", ["stripeDepositCheckoutSessionId"])
    .index("by_stripe_deposit_payment_intent", ["stripeDepositPaymentIntentId"])
    .index("by_stripe_balance_checkout_session", ["stripeBalanceCheckoutSessionId"])
    .index("by_stripe_balance_payment_intent", ["stripeBalancePaymentIntentId"]),

  // Imported timing results. Separate from seat-calendar `raceEvents`.
  timingSessions: defineTable({
    source: v.union(v.literal("speedhive"), v.literal("csv")),
    seriesId: v.id("raceSeries"),
    externalEventId: v.optional(v.string()),
    externalSessionId: v.optional(v.string()),
    eventName: v.string(),
    sessionName: v.string(),
    trackName: v.string(),
    date: v.string(),
    resultStatus: v.union(v.literal("official"), v.literal("provisional")),
    sourceUrl: v.string(),
    importedAt: v.number(),
    importedBy: v.string(),
    raceEventId: v.optional(v.id("raceEvents")),
  })
    .index("by_source_external_session", ["source", "externalSessionId"])
    .index("by_series", ["seriesId"])
    .index("by_race_event", ["raceEventId"]),

  sessionEntries: defineTable({
    sessionId: v.id("timingSessions"),
    seriesId: v.id("raceSeries"),
    carNumber: v.string(),
    teamNameRaw: v.string(),
    vehicleRaw: v.optional(v.string()),
    class: v.string(),
    posOverall: v.number(),
    posInClass: v.number(),
    laps: v.number(),
    statusRaw: v.string(),
    transponder: v.optional(v.string()),
    classStarters: v.number(),
    classWinnerLaps: v.number(),
    finishPctile: v.number(),
    lapsPctClassWinner: v.number(),
    isStart: v.boolean(),
    isDnf: v.boolean(),
    dnfReason: v.optional(v.union(v.literal("status"), v.literal("laps"))),
    teamId: v.optional(v.id("teams")),
  })
    .index("by_session", ["sessionId"])
    .index("by_team", ["teamId"])
    .index("by_series_car", ["seriesId", "carNumber"]),

  teamResultLinks: defineTable({
    teamId: v.id("teams"),
    seriesId: v.id("raceSeries"),
    carNumber: v.string(),
    nameAliases: v.array(v.string()),
    transponders: v.array(v.string()),
    // Entry ids the team confirmed or rejected. Re-import updates entries in
    // place so these ids stay valid.
    confirmedEntryIds: v.optional(v.array(v.id("sessionEntries"))),
    rejectedEntryIds: v.optional(v.array(v.id("sessionEntries"))),
    status: v.union(v.literal("pending"), v.literal("verified"), v.literal("rejected")),
    verifiedBy: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_team", ["teamId"])
    .index("by_team_series", ["teamId", "seriesId"])
    .index("by_status", ["status"])
    .index("by_series_car", ["seriesId", "carNumber"]),

  // Webhook idempotency tracking
  webhookEvents: defineTable({
    eventId: v.string(),
    source: v.union(v.literal("stripe"), v.literal("clerk"), v.literal("resend")),
    eventType: v.string(),
    processedAt: v.number(),
    expiresAt: v.optional(v.number()), // For cleanup - events older than 7 days
  })
    .index("by_event_id", ["eventId"])
    .index("by_source", ["source"])
    .index("by_expires_at", ["expiresAt"])
    .index("by_source_event_id", ["source", "eventId"]),
})
