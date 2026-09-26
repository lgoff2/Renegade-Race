import { v } from "convex/values"
import { mutation, query } from "./_generated/server"
import { sanitizeMessage, sanitizeShortText } from "./sanitize"

// Platform templates (built-in, userId is null)
const PLATFORM_TEMPLATES = [
  {
    label: "Availability Inquiry",
    content: "Is this available for my dates?",
    category: "inquiry" as const,
  },
  {
    label: "Vehicle Condition",
    content: "Can you tell me about the vehicle condition?",
    category: "inquiry" as const,
  },
  {
    label: "Available - Yes",
    content: "Yes, it's available!",
    category: "response" as const,
  },
  {
    label: "Dates Booked",
    content: "Sorry, those dates are booked.",
    category: "response" as const,
  },
  {
    label: "Track Support",
    content: "I'll bring the car to the track and support you there through the rental.",
    category: "logistics" as const,
  },
  {
    label: "Safety Briefing Required",
    content:
      "We'll need to do a quick safety briefing before you take the vehicle out on track. When works best for you?",
    category: "logistics" as const,
  },
]

// Get templates for a user (their custom templates + platform templates)
export const list = query({
  args: {
    userId: v.string(),
    category: v.optional(
      v.union(v.literal("inquiry"), v.literal("response"), v.literal("logistics"))
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    // Verify the authenticated user matches the userId
    if (identity.subject !== args.userId) {
      throw new Error("Unauthorized: Cannot access other users' data")
    }

    // Get custom templates for this user
    let customTemplatesQuery = ctx.db
      .query("messageTemplates")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))

    if (args.category) {
      customTemplatesQuery = customTemplatesQuery.filter((q) =>
        q.eq(q.field("category"), args.category)
      )
    }

    const customTemplates = await customTemplatesQuery.collect()

    // Get platform templates
    let platformTemplates = PLATFORM_TEMPLATES
    if (args.category) {
      platformTemplates = platformTemplates.filter((t) => t.category === args.category)
    }

    // Combine and return
    return {
      customTemplates,
      platformTemplates,
    }
  },
})

// Create a custom template
export const create = mutation({
  args: {
    label: v.string(),
    content: v.string(),
    category: v.union(v.literal("inquiry"), v.literal("response"), v.literal("logistics")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    const userId = identity.subject
    const now = Date.now()

    // Validate input
    if (!(args.label.trim() && args.content.trim())) {
      throw new Error("Label and content are required")
    }

    if (args.label.length > 100) {
      throw new Error("Label cannot exceed 100 characters")
    }

    if (args.content.length > 1000) {
      throw new Error("Content cannot exceed 1000 characters")
    }

    // Check if user already has too many templates
    const existingTemplates = await ctx.db
      .query("messageTemplates")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()

    const MAX_CUSTOM_TEMPLATES = 20
    if (existingTemplates.length >= MAX_CUSTOM_TEMPLATES) {
      throw new Error(`Cannot create more than ${MAX_CUSTOM_TEMPLATES} custom templates`)
    }

    // Create the template
    const templateId = await ctx.db.insert("messageTemplates", {
      userId,
      label: sanitizeShortText(args.label),
      content: sanitizeMessage(args.content),
      category: args.category,
      createdAt: now,
    })

    return templateId
  },
})

// Delete a custom template
export const deleteTemplate = mutation({
  args: {
    templateId: v.id("messageTemplates"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    const template = await ctx.db.get(args.templateId)
    if (!template) {
      throw new Error("Template not found")
    }

    // Only the owner can delete their template
    if (template.userId !== identity.subject) {
      throw new Error("Not authorized to delete this template")
    }

    // Cannot delete platform templates (userId is null)
    if (!template.userId) {
      throw new Error("Cannot delete platform templates")
    }

    await ctx.db.delete(args.templateId)

    return args.templateId
  },
})

// Get platform templates only
export const getPlatformTemplates = query({
  args: {
    category: v.optional(
      v.union(v.literal("inquiry"), v.literal("response"), v.literal("logistics"))
    ),
  },
  handler: (_ctx, args) => {
    let templates = PLATFORM_TEMPLATES
    if (args.category) {
      templates = templates.filter((t) => t.category === args.category)
    }
    return templates
  },
})

// Update a custom template
export const update = mutation({
  args: {
    templateId: v.id("messageTemplates"),
    label: v.optional(v.string()),
    content: v.optional(v.string()),
    category: v.optional(
      v.union(v.literal("inquiry"), v.literal("response"), v.literal("logistics"))
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    const template = await ctx.db.get(args.templateId)
    if (!template) {
      throw new Error("Template not found")
    }

    // Only the owner can update their template
    if (template.userId !== identity.subject) {
      throw new Error("Not authorized to update this template")
    }

    // Cannot update platform templates
    if (!template.userId) {
      throw new Error("Cannot update platform templates")
    }

    // Build update object
    const updates: {
      label?: string
      content?: string
      category?: "inquiry" | "response" | "logistics"
    } = {}

    if (args.label !== undefined) {
      if (!args.label.trim()) {
        throw new Error("Label cannot be empty")
      }
      if (args.label.length > 100) {
        throw new Error("Label cannot exceed 100 characters")
      }
      updates.label = sanitizeShortText(args.label)
    }

    if (args.content !== undefined) {
      if (!args.content.trim()) {
        throw new Error("Content cannot be empty")
      }
      if (args.content.length > 1000) {
        throw new Error("Content cannot exceed 1000 characters")
      }
      updates.content = sanitizeMessage(args.content)
    }

    if (args.category !== undefined) {
      updates.category = args.category
    }

    if (Object.keys(updates).length === 0) {
      throw new Error("No updates provided")
    }

    await ctx.db.patch(args.templateId, updates)

    return args.templateId
  },
})
