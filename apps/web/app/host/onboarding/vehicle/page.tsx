"use client"

import { CANONICAL_MAKES } from "@renegade/backend/convex/vehicleMakes"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Textarea } from "@workspace/ui/components/textarea"
import { useMutation, useQuery } from "convex/react"
import { ArrowRight, Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "@/lib/convex"
import { handleErrorWithContext } from "@/lib/error-handler"

export default function VehiclePage() {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [formData, setFormData] = useState({
    trackId: "",
    make: "",
    model: "",
    year: new Date().getFullYear(),
    dailyRate: "",
    description: "",
    // Location fields
    street: "",
    city: "",
    state: "",
    zipCode: "",
  })

  // Fetch tracks from Convex
  const tracks = useQuery(api.tracks.getAll, {})
  const saveDraft = useMutation(api.users.saveOnboardingDraft)
  const draft = useQuery(api.users.getOnboardingDraft, {})

  // Load draft data if available
  useEffect(() => {
    if (draft?.vehicleData) {
      setFormData((prev) => ({
        ...prev,
        trackId: draft.vehicleData?.trackId || "",
        make: draft.vehicleData?.make || prev.make,
        model: draft.vehicleData?.model || prev.model,
        year: draft.vehicleData?.year || prev.year,
        dailyRate: draft.vehicleData?.dailyRate
          ? String(draft.vehicleData.dailyRate)
          : prev.dailyRate,
        description: draft.vehicleData?.description || prev.description,
      }))
    }
    if (draft?.address) {
      setFormData((prev) => ({
        ...prev,
        street: draft.address?.street || prev.street,
        city: draft.address?.city || prev.city,
        state: draft.address?.state || prev.state,
        zipCode: draft.address?.zipCode || prev.zipCode,
      }))
    }
  }, [draft])

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target
    setFormData({
      ...formData,
      [name]: name === "year" || name === "dailyRate" ? (value === "" ? "" : Number(value)) : value,
    })
  }

  const handleSelectChange = (name: string, value: string) => {
    setFormData({
      ...formData,
      [name]: value,
    })
  }

  const isFormValid = () =>
    !!(
      formData.make &&
      formData.model &&
      formData.year &&
      formData.dailyRate &&
      formData.description &&
      formData.street &&
      formData.city &&
      formData.state &&
      formData.zipCode
    )

  const handleContinue = async () => {
    if (!isFormValid()) {
      toast.error("Please fill in all required fields")
      return
    }

    setIsSubmitting(true)
    try {
      // Save vehicle data to draft (will create vehicle in step 3 with photos)
      await saveDraft({
        address: {
          street: formData.street.trim(),
          city: formData.city.trim(),
          state: formData.state.trim(),
          zipCode: formData.zipCode.trim(),
        },
        vehicleData: {
          trackId: formData.trackId || undefined,
          make: formData.make,
          model: formData.model,
          year: Number(formData.year),
          dailyRate: Number(formData.dailyRate),
          description: formData.description,
          amenities: [],
          addOns: [],
        },
        currentStep: 2, // Save next step (photos)
      })

      // Redirect to photos step
      router.push("/host/onboarding/photos")
    } catch (error) {
      handleErrorWithContext(error, {
        action: "save vehicle data",
        customMessages: {
          generic: "Failed to save vehicle data. Please try again.",
        },
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (tracks === undefined) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-4 md:py-16">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-center">
            <Loader2 className="mx-auto mb-4 size-8 animate-spin text-muted-foreground" />
            <p className="text-muted-foreground">Loading...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-4 md:py-16">
      <div className="mb-4 md:mb-8">
        <h1 className="mb-2 font-bold text-3xl">Vehicle & Location</h1>
        <p className="text-muted-foreground">Tell us about your vehicle and where it is based.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Vehicle Information</CardTitle>
          <CardDescription>Basic details about your track car</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Track Selection (Optional) */}
          <div className="space-y-2">
            <Label htmlFor="trackId">Track Location (Optional)</Label>
            <Select
              onValueChange={(value) => handleSelectChange("trackId", value)}
              value={formData.trackId}
            >
              <SelectTrigger id="trackId">
                <SelectValue placeholder="Select a track (optional)" />
              </SelectTrigger>
              <SelectContent>
                {tracks.map((track: { _id: string; name: string; location: string }) => (
                  <SelectItem key={track._id} value={track._id}>
                    {track.name} - {track.location}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Vehicle Details */}
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="make">Make *</Label>
              <Input
                id="make"
                list="vehicle-makes"
                name="make"
                onChange={handleChange}
                placeholder="Porsche"
                required
                value={formData.make}
              />
              <datalist id="vehicle-makes">
                {CANONICAL_MAKES.map((make) => (
                  <option key={make} value={make} />
                ))}
              </datalist>
            </div>
            <div className="space-y-2">
              <Label htmlFor="model">Model *</Label>
              <Input
                id="model"
                name="model"
                onChange={handleChange}
                placeholder="911 GT3"
                required
                value={formData.model}
              />
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="year">Year *</Label>
              <Input
                id="year"
                name="year"
                onChange={handleChange}
                placeholder="2023"
                required
                type="number"
                value={formData.year}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dailyRate">Daily Rate ($) *</Label>
              <Input
                id="dailyRate"
                name="dailyRate"
                onChange={handleChange}
                placeholder="899"
                required
                type="number"
                value={formData.dailyRate}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description *</Label>
            <Textarea
              className="min-h-32"
              id="description"
              name="description"
              onChange={handleChange}
              placeholder="Describe your vehicle, its condition, track readiness, and what makes it special..."
              required
              value={formData.description}
            />
            <p className="text-muted-foreground text-xs">
              Provide a detailed description to attract renters
            </p>
          </div>

          {/* Location Section */}
          <div className="border-t pt-6">
            <h3 className="mb-4 font-semibold">Location</h3>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="street">Street Address *</Label>
                <Input
                  id="street"
                  name="street"
                  onChange={handleChange}
                  placeholder="123 Main Street"
                  required
                  value={formData.street}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="city">City *</Label>
                  <Input
                    id="city"
                    name="city"
                    onChange={handleChange}
                    placeholder="Los Angeles"
                    required
                    value={formData.city}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="state">State *</Label>
                  <Input
                    id="state"
                    maxLength={2}
                    name="state"
                    onChange={handleChange}
                    placeholder="CA"
                    required
                    value={formData.state}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="zipCode">ZIP Code *</Label>
                <Input
                  id="zipCode"
                  maxLength={10}
                  name="zipCode"
                  onChange={handleChange}
                  placeholder="90001"
                  required
                  value={formData.zipCode}
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-4 pt-4">
            <Button disabled={!isFormValid() || isSubmitting} onClick={handleContinue}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  Continue to Photos
                  <ArrowRight className="ml-2 size-4" />
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
