"use client"

import { useUploadFile } from "@convex-dev/r2/react"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Checkbox } from "@workspace/ui/components/checkbox"
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
import { ArrowRight, Loader2, Plus, Upload, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import type { Id } from "@/lib/convex"
import { api } from "@/lib/convex"
import { handleErrorWithContext } from "@/lib/error-handler"
import { IMAGE_ACCEPT_ATTR, isAllowedImageFile } from "@/lib/image-validation"

const ADVANCE_NOTICE_OPTIONS = [
  { value: "same-day", label: "Same day" },
  { value: "1-day", label: "1 day (recommended)" },
  { value: "2-days", label: "2 days" },
  { value: "3-days", label: "3 days" },
  { value: "1-week", label: "1 week" },
]

const TRIP_DURATION_OPTIONS = [
  { value: "1-day", label: "1 day (recommended)" },
  { value: "2-days", label: "2 days" },
  { value: "3-days", label: "3 days" },
  { value: "1-week", label: "1 week" },
  { value: "2-weeks", label: "2 weeks" },
  { value: "3-weeks", label: "3 weeks (recommended)" },
  { value: "1-month", label: "1 month" },
  { value: "2-months", label: "2 months" },
  { value: "3-months", label: "3 months" },
  { value: "unlimited", label: "Unlimited" },
]

export function OnboardingFlow({ initialStep = 1 }: { initialStep?: number }) {
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState(initialStep)

  // Shared queries and mutations
  const tracks = useQuery(api.tracks.getAll, {})
  const draft = useQuery(api.users.getOnboardingDraft, {})
  const saveDraft = useMutation(api.users.saveOnboardingDraft)
  const uploadFile = useUploadFile(api.r2)
  const createVehicleWithImages = useMutation(api.vehicles.createVehicleWithImages)
  const updateOnboardingStep = useMutation(api.users.updateHostOnboardingStep)
  const completeOnboarding = useMutation(api.users.completeHostOnboarding)

  // Step 1: Vehicle & Location state
  const [vehicleFormData, setVehicleFormData] = useState({
    trackId: "",
    make: "",
    model: "",
    year: new Date().getFullYear(),
    dailyRate: "",
    description: "",
    horsepower: "",
    transmission: "",
    drivetrain: "",
    street: "",
    city: "",
    state: "",
    zipCode: "",
  })
  const [isSubmittingVehicle, setIsSubmittingVehicle] = useState(false)

  // Step 2: Photos state
  const [images, setImages] = useState<Array<{ file: File; preview: string }>>([])
  const [isSubmittingPhotos, setIsSubmittingPhotos] = useState(false)

  // Step 3: Add-ons state
  const [addOns, setAddOns] = useState<
    Array<{
      name: string
      price: number
      description: string
      isRequired: boolean
      priceType: "daily" | "one-time"
    }>
  >([])
  const [newAddOn, setNewAddOn] = useState({
    name: "",
    price: "",
    description: "",
    isRequired: false,
    priceType: "daily" as "daily" | "one-time",
  })
  const [isSubmittingAmenities, setIsSubmittingAmenities] = useState(false)

  // Step 4: Availability state
  const [advanceNotice, setAdvanceNotice] = useState("1-day")
  const [minTripDuration, setMinTripDuration] = useState("1-day")
  const [maxTripDuration, setMaxTripDuration] = useState("3-weeks")
  const [requireWeekendMin, setRequireWeekendMin] = useState(false)
  const [isSubmittingAvailability, setIsSubmittingAvailability] = useState(false)

  // Step 5: Safety state
  const [acknowledged, setAcknowledged] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [isSubmittingSafety, setIsSubmittingSafety] = useState(false)

  // Load draft data
  useEffect(() => {
    if (draft?.vehicleData) {
      setVehicleFormData((prev) => ({
        ...prev,
        trackId: draft.vehicleData?.trackId || "",
        make: draft.vehicleData?.make || prev.make,
        model: draft.vehicleData?.model || prev.model,
        year: draft.vehicleData?.year || prev.year,
        dailyRate: draft.vehicleData?.dailyRate
          ? String(draft.vehicleData.dailyRate)
          : prev.dailyRate,
        description: draft.vehicleData?.description || prev.description,
        horsepower: draft.vehicleData?.horsepower
          ? String(draft.vehicleData.horsepower)
          : prev.horsepower,
        transmission: draft.vehicleData?.transmission || prev.transmission,
        drivetrain: draft.vehicleData?.drivetrain || prev.drivetrain,
      }))
      setAddOns(
        (draft.vehicleData?.addOns as Array<{
          name: string
          price: number
          description: string
          isRequired: boolean
          priceType: "daily" | "one-time"
        }>) || []
      )
      if (draft.vehicleData?.advanceNotice) setAdvanceNotice(draft.vehicleData.advanceNotice)
      if (draft.vehicleData.minTripDuration) setMinTripDuration(draft.vehicleData.minTripDuration)
      if (draft.vehicleData.maxTripDuration) setMaxTripDuration(draft.vehicleData.maxTripDuration)
      if (draft.vehicleData.requireWeekendMin !== undefined)
        setRequireWeekendMin(draft.vehicleData.requireWeekendMin)
    }
    if (draft?.address) {
      setVehicleFormData((prev) => ({
        ...prev,
        street: draft.address?.street || prev.street,
        city: draft.address?.city || prev.city,
        state: draft.address?.state || prev.state,
        zipCode: draft.address?.zipCode || prev.zipCode,
      }))
    }
  }, [draft])

  // Update currentStep when draft changes
  useEffect(() => {
    if (draft?.currentStep) {
      const step = Math.max(1, Math.min(draft.currentStep, 5))
      setCurrentStep(step)
    }
  }, [draft?.currentStep])

  // Step 1 Handlers
  const handleVehicleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target
    setVehicleFormData({
      ...vehicleFormData,
      [name]:
        name === "year" || name === "dailyRate" || name === "horsepower"
          ? value === ""
            ? ""
            : Number(value)
          : value,
    })
  }

  const handleVehicleSelectChange = (name: string, value: string) => {
    setVehicleFormData({
      ...vehicleFormData,
      [name]: value,
    })
  }

  const isVehicleFormValid = () =>
    !!(
      vehicleFormData.make &&
      vehicleFormData.model &&
      vehicleFormData.year &&
      vehicleFormData.dailyRate &&
      vehicleFormData.description &&
      vehicleFormData.horsepower &&
      vehicleFormData.transmission &&
      vehicleFormData.drivetrain &&
      vehicleFormData.street &&
      vehicleFormData.city &&
      vehicleFormData.state &&
      vehicleFormData.zipCode
    )

  const handleVehicleContinue = async () => {
    if (!isVehicleFormValid()) {
      toast.error("Please fill in all required fields")
      return
    }

    setIsSubmittingVehicle(true)
    try {
      await saveDraft({
        address: {
          street: vehicleFormData.street.trim(),
          city: vehicleFormData.city.trim(),
          state: vehicleFormData.state.trim(),
          zipCode: vehicleFormData.zipCode.trim(),
        },
        vehicleData: {
          trackId: vehicleFormData.trackId || undefined,
          make: vehicleFormData.make,
          model: vehicleFormData.model,
          year: Number(vehicleFormData.year),
          dailyRate: Number(vehicleFormData.dailyRate),
          description: vehicleFormData.description,
          horsepower: Number(vehicleFormData.horsepower),
          transmission: vehicleFormData.transmission,
          drivetrain: vehicleFormData.drivetrain,
          amenities: [],
          addOns: [],
        },
        currentStep: 2,
      })
      setCurrentStep(2)
    } catch (error) {
      handleErrorWithContext(error, {
        action: "save vehicle data",
        customMessages: {
          generic: "Failed to save vehicle data. Please try again.",
        },
      })
    } finally {
      setIsSubmittingVehicle(false)
    }
  }

  // Step 2 Handlers
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    for (const file of Array.from(files)) {
      if (isAllowedImageFile(file)) {
        const reader = new FileReader()
        reader.onloadend = () => {
          setImages((prev) => [...prev, { file, preview: reader.result as string }])
        }
        reader.readAsDataURL(file)
      }
    }
  }

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index))
  }

  const handlePhotosContinue = async () => {
    if (images.length === 0) {
      toast.error("Please upload at least one photo")
      return
    }

    setIsSubmittingPhotos(true)
    try {
      const imageKeys: string[] = []
      for (let index = 0; index < images.length; index++) {
        const img = images[index]
        if (!img) continue
        try {
          if (index > 0) {
            await new Promise((resolve) => setTimeout(resolve, 500))
          }
          const key = await uploadFile(img.file)
          imageKeys.push(key)
        } catch (error) {
          handleErrorWithContext(error, {
            action: `upload image "${img.file.name}"`,
            customMessages: {
              file_upload: `Failed to upload ${img.file.name}. Please try again.`,
              generic: `Failed to upload ${img.file.name}. Please try again.`,
            },
          })
          throw new Error("Failed to upload image")
        }
      }

      const imageData = imageKeys.map((r2Key, index) => ({
        r2Key,
        isPrimary: index === 0,
        order: index,
      }))

      await saveDraft({
        images: imageData,
        currentStep: 3,
      })

      toast.success("Photos uploaded successfully!")
      setCurrentStep(3)
    } catch (error) {
      handleErrorWithContext(error, {
        action: "upload photos",
        customMessages: {
          file_upload: "Failed to upload photos. Please try again.",
          generic: "Failed to upload photos. Please try again.",
        },
      })
    } finally {
      setIsSubmittingPhotos(false)
    }
  }

  // Step 3 Handlers
  const addAddOn = () => {
    if (newAddOn.name && newAddOn.price) {
      setAddOns((prev) => [
        ...prev,
        {
          name: newAddOn.name,
          price: Number(newAddOn.price),
          description: newAddOn.description,
          isRequired: newAddOn.isRequired,
          priceType: newAddOn.priceType,
        },
      ])
      setNewAddOn({ name: "", price: "", description: "", isRequired: false, priceType: "daily" })
    }
  }

  const removeAddOn = (index: number) => {
    setAddOns((prev) => prev.filter((_, i) => i !== index))
  }

  const handleAmenitiesContinue = async () => {
    if (!(draft?.vehicleData && draft?.address)) {
      toast.error("Missing vehicle data. Please complete previous steps.")
      return
    }

    setIsSubmittingAmenities(true)
    try {
      await saveDraft({
        vehicleData: {
          ...draft.vehicleData,
          amenities: [],
          addOns,
        },
        currentStep: 4,
      })
      setCurrentStep(4)
    } catch (error) {
      handleErrorWithContext(error, {
        action: "save amenities",
        customMessages: {
          generic: "Failed to save amenities. Please try again.",
        },
      })
    } finally {
      setIsSubmittingAmenities(false)
    }
  }

  // Step 4 Handlers
  const handleAvailabilityContinue = async () => {
    if (!(draft?.vehicleData && draft?.address)) {
      toast.error("Missing vehicle data. Please complete previous steps.")
      return
    }

    setIsSubmittingAvailability(true)
    try {
      await saveDraft({
        vehicleData: {
          ...draft.vehicleData,
          advanceNotice,
          minTripDuration,
          maxTripDuration,
          requireWeekendMin,
        },
        currentStep: 5,
      })
      setCurrentStep(5)
    } catch (error) {
      handleErrorWithContext(error, {
        action: "save availability",
        customMessages: {
          generic: "Failed to save availability. Please try again.",
        },
      })
    } finally {
      setIsSubmittingAvailability(false)
    }
  }

  // Step 5 Handlers
  const handleSafetySubmit = async () => {
    if (!(acknowledged && termsAccepted)) {
      toast.error("Please acknowledge all requirements")
      return
    }

    if (!(draft?.vehicleData && draft?.address)) {
      toast.error("Missing vehicle data. Please complete previous steps.")
      return
    }

    let imagesData: Array<{ r2Key: string; isPrimary: boolean; order: number }> = []
    if (draft.images && draft.images.length > 0) {
      imagesData = draft.images
    }

    if (imagesData.length === 0) {
      toast.error("Please upload at least one photo")
      setCurrentStep(2)
      return
    }

    setIsSubmittingSafety(true)
    try {
      await createVehicleWithImages({
        trackId: draft.vehicleData.trackId
          ? (draft.vehicleData.trackId as Id<"tracks">)
          : undefined,
        make: draft.vehicleData.make,
        model: draft.vehicleData.model,
        year: draft.vehicleData.year,
        dailyRate: draft.vehicleData.dailyRate,
        description: draft.vehicleData.description,
        horsepower: draft.vehicleData.horsepower,
        transmission: draft.vehicleData.transmission,
        drivetrain: draft.vehicleData.drivetrain,
        amenities: draft.vehicleData.amenities || [],
        addOns: draft.vehicleData.addOns || [],
        address: draft.address,
        advanceNotice: draft.vehicleData.advanceNotice,
        minTripDuration: draft.vehicleData.minTripDuration,
        maxTripDuration: draft.vehicleData.maxTripDuration,
        requireWeekendMin: draft.vehicleData.requireWeekendMin,
        images: imagesData,
      })

      await updateOnboardingStep({
        step: "vehicleAdded",
        completed: true,
      })

      await updateOnboardingStep({
        step: "safetyStandards",
        completed: true,
      })

      await completeOnboarding()

      toast.success("Vehicle listing submitted successfully!")
      router.push("/host/onboarding/complete")
    } catch (error) {
      handleErrorWithContext(error, {
        action: "submit vehicle listing",
        customMessages: {
          generic: "Failed to submit vehicle listing. Please try again.",
        },
      })
    } finally {
      setIsSubmittingSafety(false)
    }
  }

  // Render step content
  const renderStep = () => {
    // Step 1: Vehicle & Location
    if (currentStep === 1) {
      if (tracks === undefined) {
        return (
          <div className="container mx-auto max-w-2xl px-4 pb-4 md:pb-16">
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
        <div className="container mx-auto max-w-2xl px-4 pb-4 md:pb-16">
          <div className="mb-4 md:mb-8">
            <h1 className="mb-2 font-bold text-3xl">Vehicle & Location</h1>
            <p className="text-muted-foreground">
              Tell us about your vehicle and where it is based.
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Vehicle Information</CardTitle>
              <CardDescription>Basic details about your track car</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="trackId">Track Location (Optional)</Label>
                <Select
                  onValueChange={(value) => handleVehicleSelectChange("trackId", value)}
                  value={vehicleFormData.trackId}
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

              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="make">Make *</Label>
                  <Input
                    id="make"
                    name="make"
                    onChange={handleVehicleChange}
                    placeholder="Porsche"
                    required
                    value={vehicleFormData.make}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="model">Model *</Label>
                  <Input
                    id="model"
                    name="model"
                    onChange={handleVehicleChange}
                    placeholder="911 GT3"
                    required
                    value={vehicleFormData.model}
                  />
                </div>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="year">Year *</Label>
                  <Input
                    id="year"
                    name="year"
                    onChange={handleVehicleChange}
                    placeholder="2023"
                    required
                    type="number"
                    value={vehicleFormData.year}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dailyRate">Daily Rate ($) *</Label>
                  <Input
                    id="dailyRate"
                    name="dailyRate"
                    onChange={handleVehicleChange}
                    placeholder="899"
                    required
                    type="number"
                    value={vehicleFormData.dailyRate}
                  />
                </div>
              </div>

              <div className="grid gap-6 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="horsepower">Horsepower *</Label>
                  <Input
                    id="horsepower"
                    name="horsepower"
                    onChange={handleVehicleChange}
                    placeholder="500"
                    required
                    type="number"
                    value={vehicleFormData.horsepower}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="transmission">Transmission *</Label>
                  <Select
                    onValueChange={(value) => handleVehicleSelectChange("transmission", value)}
                    required
                    value={vehicleFormData.transmission}
                  >
                    <SelectTrigger id="transmission">
                      <SelectValue placeholder="Select transmission" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">Manual</SelectItem>
                      <SelectItem value="automatic">Automatic</SelectItem>
                      <SelectItem value="sequential">Sequential</SelectItem>
                      <SelectItem value="paddle-shift">Paddle Shift</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="drivetrain">Drivetrain *</Label>
                  <Select
                    onValueChange={(value) => handleVehicleSelectChange("drivetrain", value)}
                    required
                    value={vehicleFormData.drivetrain}
                  >
                    <SelectTrigger id="drivetrain">
                      <SelectValue placeholder="Select drivetrain" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rwd">RWD (Rear-Wheel Drive)</SelectItem>
                      <SelectItem value="fwd">FWD (Front-Wheel Drive)</SelectItem>
                      <SelectItem value="awd">AWD (All-Wheel Drive)</SelectItem>
                      <SelectItem value="4wd">4WD (Four-Wheel Drive)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description *</Label>
                <Textarea
                  className="min-h-32"
                  id="description"
                  name="description"
                  onChange={handleVehicleChange}
                  placeholder="Describe your vehicle, its condition, track readiness, and what makes it special..."
                  required
                  value={vehicleFormData.description}
                />
                <p className="text-muted-foreground text-xs">
                  Provide a detailed description to attract renters
                </p>
              </div>

              <div className="border-t pt-6">
                <h3 className="mb-4 font-semibold">Location</h3>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="street">Street Address *</Label>
                    <Input
                      id="street"
                      name="street"
                      onChange={handleVehicleChange}
                      placeholder="123 Main Street"
                      required
                      value={vehicleFormData.street}
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="city">City *</Label>
                      <Input
                        id="city"
                        name="city"
                        onChange={handleVehicleChange}
                        placeholder="Los Angeles"
                        required
                        value={vehicleFormData.city}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="state">State *</Label>
                      <Input
                        id="state"
                        maxLength={2}
                        name="state"
                        onChange={handleVehicleChange}
                        placeholder="CA"
                        required
                        value={vehicleFormData.state}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="zipCode">ZIP Code *</Label>
                    <Input
                      id="zipCode"
                      maxLength={10}
                      name="zipCode"
                      onChange={handleVehicleChange}
                      placeholder="90001"
                      required
                      value={vehicleFormData.zipCode}
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-4 pt-4">
                <Button
                  disabled={!isVehicleFormValid() || isSubmittingVehicle}
                  onClick={handleVehicleContinue}
                >
                  {isSubmittingVehicle ? (
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

    // Step 2: Photos
    if (currentStep === 2) {
      return (
        <div className="container mx-auto max-w-2xl px-4 py-4 md:py-16">
          <div className="mb-4 md:mb-8">
            <h1 className="mb-2 font-bold text-3xl">Vehicle Photos</h1>
            <p className="text-muted-foreground">
              Upload photos of your vehicle. At least one photo is required.
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Upload Photos</CardTitle>
              <CardDescription>
                Show off your vehicle with high-quality photos. The first image will be used as the
                main image.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div>
                  <Label>Vehicle Photos *</Label>
                  <p className="text-muted-foreground text-xs">
                    Upload at least one photo. The first image will be used as the main image.
                  </p>
                </div>

                <div className="flex flex-wrap gap-4">
                  {images.map((image, index) => (
                    <div className="relative" key={index}>
                      <div className="relative size-32 overflow-hidden rounded-lg border">
                        <img
                          alt={`Preview ${index + 1}`}
                          className="size-full object-cover"
                          src={image.preview}
                        />
                        {index === 0 && (
                          <div className="absolute top-1 left-1 rounded bg-primary px-1.5 py-0.5 font-medium text-primary-foreground text-xs">
                            Primary
                          </div>
                        )}
                      </div>
                      <Button
                        className="absolute -top-2 -right-2 size-6 rounded-full p-0"
                        onClick={() => removeImage(index)}
                        size="icon"
                        type="button"
                        variant="destructive"
                      >
                        <X className="size-3" />
                      </Button>
                    </div>
                  ))}

                  <label className="flex size-32 cursor-pointer items-center justify-center rounded-lg border-2 border-muted-foreground/25 border-dashed transition-colors hover:border-primary">
                    <div className="text-center">
                      <Upload className="mx-auto mb-2 size-6 text-muted-foreground" />
                      <span className="text-muted-foreground text-xs">Add Photo</span>
                    </div>
                    <input
                      accept={IMAGE_ACCEPT_ATTR}
                      className="hidden"
                      multiple
                      onChange={handleImageUpload}
                      type="file"
                    />
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-4 pt-4">
                <Button
                  disabled={images.length === 0 || isSubmittingPhotos}
                  onClick={handlePhotosContinue}
                >
                  {isSubmittingPhotos ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      Continue to Add-ons
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

    // Step 3: Add-ons
    if (currentStep === 3) {
      return (
        <div className="container mx-auto max-w-2xl px-4 py-4 md:py-16">
          <div className="mb-4 md:mb-8">
            <h1 className="mb-2 font-bold text-3xl">Add-ons</h1>
            <p className="text-muted-foreground">
              Add optional extras that renters can purchase with your vehicle.
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Optional Add-ons</CardTitle>
              <CardDescription>Additional services or items renters can purchase</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                {addOns.length > 0 && (
                  <div className="space-y-2">
                    {addOns.map((addOn, index) => (
                      <div
                        className="flex items-center justify-between rounded-lg border p-3"
                        key={index}
                      >
                        <div className="flex-1">
                          <p className="font-medium">{addOn.name}</p>
                          {addOn.description && (
                            <p className="text-muted-foreground text-sm">{addOn.description}</p>
                          )}
                          <p className="font-semibold text-primary">
                            ${addOn.price}
                            {addOn.priceType === "daily" ? "/day" : " one-time"}
                          </p>
                        </div>
                        <Button
                          onClick={() => removeAddOn(index)}
                          size="icon"
                          type="button"
                          variant="ghost"
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-3 rounded-lg border p-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="addOnName">Add-on Name</Label>
                      <Input
                        id="addOnName"
                        onChange={(e) => setNewAddOn((prev) => ({ ...prev, name: e.target.value }))}
                        placeholder="e.g., Professional Driving Instructor"
                        value={newAddOn.name}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="addOnPrice">Price ($)</Label>
                      <Input
                        id="addOnPrice"
                        onChange={(e) =>
                          setNewAddOn((prev) => ({ ...prev, price: e.target.value }))
                        }
                        placeholder="150"
                        type="number"
                        value={newAddOn.price}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="addOnPriceType">Payment Type</Label>
                    <Select
                      onValueChange={(value: "daily" | "one-time") =>
                        setNewAddOn((prev) => ({ ...prev, priceType: value }))
                      }
                      value={newAddOn.priceType}
                    >
                      <SelectTrigger id="addOnPriceType">
                        <SelectValue placeholder="Select payment type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">Daily fee</SelectItem>
                        <SelectItem value="one-time">One-time payment</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="addOnDescription">Description (Optional)</Label>
                    <Input
                      id="addOnDescription"
                      onChange={(e) =>
                        setNewAddOn((prev) => ({ ...prev, description: e.target.value }))
                      }
                      placeholder="Brief description of the add-on"
                      value={newAddOn.description}
                    />
                  </div>
                  <Button onClick={addAddOn} type="button" variant="outline">
                    <Plus className="mr-2 size-4" />
                    Add Add-on
                  </Button>
                </div>
              </div>

              <div className="flex justify-end gap-4 pt-4">
                <Button disabled={isSubmittingAmenities} onClick={handleAmenitiesContinue}>
                  {isSubmittingAmenities ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      Continue to Availability
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

    // Step 4: Availability
    if (currentStep === 4) {
      return (
        <div className="container mx-auto max-w-2xl px-4 py-4 md:py-16">
          <div className="mb-4 md:mb-8">
            <h1 className="mb-2 font-bold text-3xl">Availability</h1>
            <p className="text-muted-foreground">
              Set when your vehicle is available for rent. You can update this anytime from your
              dashboard.
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Default Availability Settings</CardTitle>
              <CardDescription>
                Configure your vehicle's default availability rules. You can update these anytime
                from your dashboard.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
              <div className="space-y-4">
                <div>
                  <h3 className="mb-1 font-semibold">Advance notice</h3>
                  <p className="text-muted-foreground text-sm">
                    How much advance notice do you need before a trip starts?
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="advanceNotice">Advance notice</Label>
                  <Select onValueChange={setAdvanceNotice} value={advanceNotice}>
                    <SelectTrigger id="advanceNotice">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ADVANCE_NOTICE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <h3 className="mb-1 font-semibold">Trip duration</h3>
                  <p className="text-muted-foreground text-sm">
                    What's the shortest and longest possible trip you'll accept?
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="minTripDuration">Minimum trip duration</Label>
                    <Select onValueChange={setMinTripDuration} value={minTripDuration}>
                      <SelectTrigger id="minTripDuration">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TRIP_DURATION_OPTIONS.filter((opt) => opt.value !== "unlimited").map(
                          (option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
                    <Checkbox
                      checked={requireWeekendMin}
                      id="requireWeekendMin"
                      onCheckedChange={(checked) => setRequireWeekendMin(checked === true)}
                    />
                    <Label
                      className="cursor-pointer font-normal leading-tight"
                      htmlFor="requireWeekendMin"
                    >
                      Require a 2-day minimum for trips that start Friday, Saturday, or Sunday
                    </Label>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="maxTripDuration">Maximum trip duration</Label>
                    <Select onValueChange={setMaxTripDuration} value={maxTripDuration}>
                      <SelectTrigger id="maxTripDuration">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TRIP_DURATION_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-4 pt-4">
                <Button disabled={isSubmittingAvailability} onClick={handleAvailabilityContinue}>
                  {isSubmittingAvailability ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      Continue to Safety
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

    // Step 5: Safety
    if (currentStep === 5) {
      if (draft === undefined) {
        return (
          <div className="container mx-auto max-w-2xl px-4 pb-4 md:pb-16">
            <div className="flex min-h-[60vh] items-center justify-center">
              <div className="text-center">
                <Loader2 className="mx-auto mb-4 size-8 animate-spin text-muted-foreground" />
                <p className="text-muted-foreground">Loading...</p>
              </div>
            </div>
          </div>
        )
      }

      if (!(draft?.vehicleData && draft?.address)) {
        return (
          <div className="container mx-auto max-w-2xl px-4 pb-4 md:pb-16">
            <Card>
              <CardContent className="py-12 text-center">
                <p className="mb-4 text-muted-foreground">
                  Please complete the previous steps first.
                </p>
              </CardContent>
            </Card>
          </div>
        )
      }

      return (
        <div className="container mx-auto max-w-2xl px-4 py-4 md:py-16">
          <div className="mb-4 md:mb-8">
            <h1 className="mb-2 font-bold text-3xl">Safety & Quality Standards</h1>
            <p className="text-muted-foreground">
              Review and acknowledge our safety requirements and quality standards.
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Host Requirements</CardTitle>
              <CardDescription>
                Ensure your vehicle meets our safety and quality standards
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <h3 className="font-semibold">Vehicle Requirements</h3>
                <ul className="list-inside list-disc space-y-2 text-muted-foreground">
                  <li>Vehicle must be in good working condition</li>
                  <li>All safety equipment must be functional</li>
                  <li>Vehicle must be properly insured</li>
                  <li>Track-ready vehicles must meet track safety standards</li>
                  <li>All modifications must be disclosed</li>
                </ul>
              </div>

              <div className="space-y-4">
                <h3 className="font-semibold">Photo Requirements</h3>
                <ul className="list-inside list-disc space-y-2 text-muted-foreground">
                  <li>At least one high-quality photo required</li>
                  <li>Photos must accurately represent the vehicle</li>
                  <li>Include photos of any damage or wear</li>
                  <li>Show interior, exterior, and key features</li>
                </ul>
              </div>

              <div className="space-y-4">
                <h3 className="font-semibold">Host Responsibilities</h3>
                <ul className="list-inside list-disc space-y-2 text-muted-foreground">
                  <li>Respond to booking requests promptly</li>
                  <li>Maintain vehicle in listed condition</li>
                  <li>Provide accurate vehicle information</li>
                  <li>Follow all platform policies and guidelines</li>
                </ul>
              </div>

              <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={acknowledged}
                    id="acknowledged"
                    onCheckedChange={(checked) => setAcknowledged(checked === true)}
                  />
                  <Label className="cursor-pointer font-normal" htmlFor="acknowledged">
                    I acknowledge that my vehicle meets all safety and quality requirements listed
                    above
                  </Label>
                </div>
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={termsAccepted}
                    id="terms"
                    onCheckedChange={(checked) => setTermsAccepted(checked === true)}
                  />
                  <Label className="cursor-pointer font-normal" htmlFor="terms">
                    I have read and agree to the{" "}
                    <a
                      className="text-primary underline"
                      href="/terms"
                      rel="noopener"
                      target="_blank"
                    >
                      Terms of Service
                    </a>{" "}
                    and{" "}
                    <a
                      className="text-primary underline"
                      href="/privacy"
                      rel="noopener"
                      target="_blank"
                    >
                      Privacy Policy
                    </a>
                  </Label>
                </div>
              </div>

              <div className="flex justify-end gap-4 pt-4">
                <Button
                  disabled={!(acknowledged && termsAccepted) || isSubmittingSafety}
                  onClick={handleSafetySubmit}
                >
                  {isSubmittingSafety ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      Submit Listing
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

    return null
  }

  return renderStep()
}
