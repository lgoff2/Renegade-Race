"use client"

import { useClerk, useUser } from "@clerk/nextjs"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Sheet, SheetContent, SheetTitle } from "@workspace/ui/components/sheet"
import { cn } from "@workspace/ui/lib/utils"
import {
  AlertTriangle,
  Calendar,
  Car,
  DollarSign,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Mail,
  MapPin,
  Menu,
  MessageSquare,
  Settings,
  Shield,
  Star,
  Trophy,
  User,
  Users,
} from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Reservations", href: "/reservations", icon: Calendar },
  { name: "Payments", href: "/payments", icon: DollarSign },
  { name: "Vehicles", href: "/vehicles", icon: Car },
  { name: "Reviews", href: "/reviews", icon: Star },
  { name: "User Management", href: "/users", icon: Users },
  { name: "Track Management", href: "/tracks", icon: MapPin },
  { name: "Coaching", href: "/coaching/coaches", icon: GraduationCap },
  { name: "Race results", href: "/results", icon: Trophy },
  { name: "Disputes", href: "/disputes", icon: Shield },
  { name: "Damage Claims", href: "/damage-invoices", icon: AlertTriangle },
  { name: "Direct Messages", href: "/messages", icon: MessageSquare },
  { name: "Emails", href: "/mass-emails", icon: Mail },
  { name: "Platform Settings", href: "/settings", icon: Settings },
]

function SidebarContent() {
  const pathname = usePathname()
  const { signOut } = useClerk()
  const { user } = useUser()

  const handleSignOut = () => {
    signOut({ redirectUrl: "/sign-in" })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center border-b px-6">
        <div className="flex items-center gap-2">
          <Image
            alt="Renegade Logo"
            className="rounded-full"
            height={40}
            src="/logo.png"
            width={40}
          />
          <span className="font-bold text-lg">Admin Portal</span>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-4">
        {navigation.map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`)
          return (
            <Link
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 font-medium text-sm transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
              href={item.href}
              key={item.name}
            >
              <item.icon className="size-4" />
              {item.name}
            </Link>
          )
        })}
      </nav>

      <div className="border-t p-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="w-full justify-start" variant="ghost">
              <User className="mr-2 size-4" />
              <span className="flex-1 text-left">
                {user?.firstName || user?.emailAddresses?.[0]?.emailAddress || "User"}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-2 py-1.5">
              <p className="font-medium text-sm">
                {user?.firstName && user?.lastName
                  ? `${user.firstName} ${user.lastName}`
                  : user?.firstName || "Admin User"}
              </p>
              <p className="text-muted-foreground text-xs">
                {user?.emailAddresses?.[0]?.emailAddress}
              </p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut}>
              <LogOut className="mr-2 size-4" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

export function AdminSidebar() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <>
      {/* Mobile header bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 border-b bg-card px-4 md:hidden">
        <Button onClick={() => setOpen(true)} size="icon" variant="ghost">
          <Menu className="size-5" />
          <span className="sr-only">Open menu</span>
        </Button>
        <Image
          alt="Renegade Logo"
          className="rounded-full"
          height={28}
          src="/logo.png"
          width={28}
        />
        <span className="font-bold text-sm">Admin Portal</span>
      </div>

      {/* Mobile sheet drawer */}
      <Sheet onOpenChange={setOpen} open={open}>
        <SheetContent className="w-64 p-0" side="left">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent />
        </SheetContent>
      </Sheet>

      {/* Desktop sidebar */}
      <div className="hidden h-full w-64 flex-col border-r bg-card md:flex">
        <SidebarContent />
      </div>
    </>
  )
}
