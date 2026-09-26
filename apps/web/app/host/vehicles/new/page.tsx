"use client"

import { useUser } from "@clerk/nextjs"
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
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, Plus, Upload, X } from "lucide-react"
import Link from "next/link"
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

export default function CreateVehiclePage() {
  const router = useRouter()
  const { user } = useUser()
  const [currentStep, setCurrentStep] = useState(1)

  // Check onboarding status - protect this route
  const onboardingStatus = useQuery(api.users.getHostOnboardingStatus, user?.id ? {} : "skip")

  // Redirect to onboarding if not completed
  useEffect(() => {
    if (onboardingStatus && onboardingStatus.status !== "completed") {
      router.push("/host/onboarding")
    }
  }, [onboardingStatus, router])

  // Fetch tracks from Convex
  const tracks = useQuery(api.tracks.getAll, {})
  const createVehicleWithImages = useMutation(api.vehicles.createVehicleWithImages)
  const uploadFile = useUploadFile(api.r2)

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
    zipCode: "",
  })

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

  // Step 4: Availability state
  const [advanceNotice, setAdvanceNotice] = useState("1-day")
  const [minTripDuration, setMinTripDuration] = useState("1-day")
  const [maxTripDuration, setMaxTripDuration] = useState("3-weeks")
  const [requireWeekendMin, setRequireWeekendMin] = useState(false)

  // Step 5: Safety state
  const [acknowledged, setAcknowledged] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Uploaded image keys (stored after step 2)
  const [uploadedImageKeys, setUploadedImageKeys] = useState<string[]>([])

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
      vehicleFormData.zipCode
    )

  const handleVehicleContinue = () => {
    if (!isVehicleFormValid()) {
      toast.error("Please fill in all required fields")
      return
    }
    setCurrentStep(2)
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

      setUploadedImageKeys(imageKeys)
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

  const handleAddOnsContinue = () => {
    setCurrentStep(4)
  }

  // Step 4 Handlers
  const handleAvailabilityContinue = () => {
    setCurrentStep(5)
  }

  // Step 5 Handlers - Final Submit
  const handleFinalSubmit = async () => {
    if (!(acknowledged && termsAccepted)) {
      toast.error("Please acknowledge all requirements")
      return
    }

    if (uploadedImageKeys.length === 0) {
      toast.error("Please upload at least one photo")
      setCurrentStep(2)
      return
    }

    setIsSubmitting(true)
    try {
      await createVehicleWithImages({
        trackId: vehicleFormData.trackId ? (vehicleFormData.trackId as Id<"tracks">) : undefined,
        make: vehicleFormData.make,
        model: vehicleFormData.model,
        year: Number(vehicleFormData.year),
        dailyRate: Number(vehicleFormData.dailyRate),
        description: vehicleFormData.description,
        horsepower: Number(vehicleFormData.horsepower),
        transmission: vehicleFormData.transmission,
        drivetrain: vehicleFormData.drivetrain,
        amenities: [],
        addOns: addOns.map((addOn) => ({
          name: addOn.name,
          price: addOn.price,
          description: addOn.description,
          isRequired: addOn.isRequired,
          priceType: addOn.priceType,
        })),
        address: {
          zipCode: vehicleFormData.zipCode.trim(),
        },
        advanceNotice,
        minTripDuration,
        maxTripDuration,
        requireWeekendMin,
        images: uploadedImageKeys.map((r2Key, index) => ({
          r2Key,
          isPrimary: index === 0,
          order: index,
        })),
      })

      toast.success("Vehicle listed successfully!")
      router.push("/host/vehicles/list")
    } catch (error) {
      handleErrorWithContext(error, {
        action: "create vehicle",
        entity: "vehicle",
        customMessages: {
          file_upload: "Failed to upload vehicle images. Please try again.",
          generic: "Failed to create vehicle. Please try again.",
        },
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  // Show loading or redirect if onboarding not complete
  if (!onboardingStatus || onboardingStatus.status !== "completed") {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-center">
            <Loader2 className="mx-auto mb-4 size-8 animate-spin text-muted-foreground" />
            <p className="text-muted-foreground">Loading...</p>
          </div>
        </div>
      </div>
    )
  }

  // Show loading state while tracks are loading
  if (tracks === undefined) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-center">
            <Loader2 className="mx-auto mb-4 size-8 animate-spin text-muted-foreground" />
            <p className="text-muted-foreground">Loading tracks...</p>
          </div>
        </div>
      </div>
    )
  }

  const steps = [
    { number: 1, title: "Vehicle & Location" },
    { number: 2, title: "Photos" },
    { number: 3, title: "Add-ons" },
    { number: 4, title: "Availability" },
    { number: 5, title: "Safety" },
  ]

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <div className="mb-8">
        <Link href="/host/vehicles/list">
          <Button size="sm" variant="ghost">
            <ArrowLeft className="mr-2 size-4" />
            Back to Vehicles
          </Button>
        </Link>
        <h1 className="mt-4 font-bold text-3xl">List Your Vehicle</h1>
        <p className="mt-2 text-muted-foreground">
          Add your track car to the platform and start earning rental income
        </p>
      </div>

      {/* Progress Steps */}
      <div className="mb-8 flex justify-center overflow-x-auto">
        <div className="flex items-center">
          {steps.map((step, index) => (
            <div className="flex items-center" key={step.number}>
              <div className="flex flex-col items-center">
                <div
                  className={`flex size-10 items-center justify-center rounded-full border-2 font-semibold ${
                    currentStep === step.number
                      ? "border-primary bg-primary text-primary-foreground"
                      : currentStep > step.number
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-muted bg-muted text-muted-foreground"
                  }`}
                >
                  {currentStep > step.number ? <CheckCircle2 className="size-5" /> : step.number}
                </div>
                <div className="mt-2 hidden text-center md:block">
                  <p
                    className={`font-medium text-xs ${
                      currentStep === step.number ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {step.title}
                  </p>
                </div>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`mx-2 h-0.5 w-8 md:mx-4 md:w-16 ${
                    currentStep > step.number ? "bg-primary" : "bg-muted"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step 1: Vehicle & Location */}
      {currentStep === 1 && (
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

            <div className="flex justify-end gap-4 pt-4">
              <Button disabled={!isVehicleFormValid()} onClick={handleVehicleContinue}>
                Continue to Photos
                <ArrowRight className="ml-2 size-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Photos */}
      {currentStep === 2 && (
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

            <div className="flex justify-between gap-4 pt-4">
              <Button onClick={() => setCurrentStep(1)} variant="outline">
                <ArrowLeft className="mr-2 size-4" />
                Back
              </Button>
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
      )}

      {/* Step 3: Add-ons */}
      {currentStep === 3 && (
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
                      onChange={(e) => setNewAddOn((prev) => ({ ...prev, price: e.target.value }))}
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

            <div className="flex justify-between gap-4 pt-4">
              <Button onClick={() => setCurrentStep(2)} variant="outline">
                <ArrowLeft className="mr-2 size-4" />
                Back
              </Button>
              <Button onClick={handleAddOnsContinue}>
                Continue to Availability
                <ArrowRight className="ml-2 size-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Availability */}
      {currentStep === 4 && (
        <Card>
          <CardHeader>
            <CardTitle>Default Availability Settings</CardTitle>
            <CardDescription>
              Configure your vehicle's default availability rules. You can update these anytime from
              your dashboard.
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

            <div className="flex justify-between gap-4 pt-4">
              <Button onClick={() => setCurrentStep(3)} variant="outline">
                <ArrowLeft className="mr-2 size-4" />
                Back
              </Button>
              <Button onClick={handleAvailabilityContinue}>
                Continue to Safety
                <ArrowRight className="ml-2 size-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 5: Safety */}
      {currentStep === 5 && (
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

            <div className="flex justify-between gap-4 pt-4">
              <Button onClick={() => setCurrentStep(4)} variant="outline">
                <ArrowLeft className="mr-2 size-4" />
                Back
              </Button>
              <Button
                disabled={!(acknowledged && termsAccepted) || isSubmitting}
                onClick={handleFinalSubmit}
              >
                {isSubmitting ? (
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
      )}
    </div>
  )
}
