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
    // Pickup location address
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
      v.union(v.literal("rental"), v.literal("team"), v.literal("driver"), v.literal("coaching"))
    ),
    teamId: v.optional(v.id("teams")),
    driverProfileId: v.optional(v.id("driverProfiles")),
    coachProfileId: v.optional(v.id("coachProfiles")),
    reservationId: v.optional(v.id("reservations")),
    coachingBookingId: v.optional(v.id("coachingBookings")),
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
    .index("by_coaching_booking", ["coachingBookingId"]),

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
    amount: v.number(), // Total amount in cents
    platformFee: v.number(), // Platform fee in cents
    ownerAmount: v.number(), // Amount owner receives in cents
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
    minimumPlatformFee: v.number(), // Minimum fee in cents
    maximumPlatformFee: v.optional(v.number()), // Maximum fee in cents
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
  // Request-to-book only — no seat conversations / Message Host cut-out in v1.
  raceSeries: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    organizer: v.optional(v.string()),
    website: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    isActive: v.boolean(),
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
    driverMessage: v.optional(v.string()),
    teamMessage: v.optional(v.string()),
    cancellationReason: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    waitlistedAt: v.optional(v.number()),
    depositPaidAt: v.optional(v.number()),
    confirmedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    // Stubbed until seatPayments (Stripe Checkout) lands. Do not use payments.reservationId.
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
