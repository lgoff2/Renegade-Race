import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import SignUpPage from "@/app/(auth)/sign-up/[[...sign-up]]/page"

const TERMS_CHECKBOX_LABEL = /I have read and agree to the/
const TERMS_REQUIRED_ERROR = /You must accept the Terms of Service and Privacy Policy/

const mockPush = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}))

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    ...rest
  }: {
    src: string
    alt: string
    className?: string
    width?: number
    height?: number
  }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={typeof src === "string" ? src : ""} {...rest} />
  ),
}))

vi.mock("@/lib/error-handler", () => ({
  handleError: vi.fn(),
}))

const signUpCreate = vi.fn()
const authenticateWithRedirect = vi.fn()
const prepareEmailAddressVerification = vi.fn()

vi.mock("@clerk/nextjs", () => ({
  useSignUp: () => ({
    signUp: {
      create: signUpCreate,
      authenticateWithRedirect,
      prepareEmailAddressVerification,
      unverifiedFields: [] as string[],
      status: null as string | null,
    },
    isLoaded: true,
    setActive: vi.fn(),
  }),
}))

describe("User onboarding — sign up page", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders the registration form", () => {
    render(<SignUpPage />)

    expect(screen.getByRole("heading", { name: "Create your account" })).toBeInTheDocument()
    expect(
      screen.getByText("Join Renegade and start renting high-performance track cars")
    ).toBeInTheDocument()
    expect(screen.getByLabelText("First Name")).toBeInTheDocument()
    expect(screen.getByLabelText("Last Name")).toBeInTheDocument()
    expect(screen.getByLabelText("Email")).toBeInTheDocument()
    expect(
      screen.getByLabelText("Password", { selector: 'input[type="password"]' })
    ).toBeInTheDocument()
  })

  it("keeps Create account disabled until terms are accepted", async () => {
    const user = userEvent.setup()
    render(<SignUpPage />)

    const submit = screen.getByRole("button", { name: "Create account" })
    expect(submit).toBeDisabled()

    await user.click(screen.getByLabelText(TERMS_CHECKBOX_LABEL))
    expect(submit).toBeEnabled()
  })

  it("shows a validation message when submitting without accepting terms", async () => {
    const user = userEvent.setup()
    const { container } = render(<SignUpPage />)

    await user.type(screen.getByLabelText("First Name"), "Test")
    await user.type(screen.getByLabelText("Last Name"), "User")
    await user.type(screen.getByLabelText("Email"), "test@example.com")
    await user.type(
      screen.getByLabelText("Password", { selector: 'input[type="password"]' }),
      "password123"
    )

    const form = container.querySelector("form")
    expect(form).toBeTruthy()
    fireEvent.submit(form as HTMLFormElement)

    expect(await screen.findByText(TERMS_REQUIRED_ERROR)).toBeInTheDocument()
    expect(signUpCreate).not.toHaveBeenCalled()
  })

  it("links to sign-in for existing users", () => {
    render(<SignUpPage />)

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in")
  })
})
