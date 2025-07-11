import { type NextRequest, NextResponse } from "next/server"
import { collection, addDoc, getDocs, query, orderBy, where, limit, serverTimestamp } from "firebase/firestore"
import { db } from "@/lib/firebase/config"
import type { Product } from "@/lib/types"

// Admin authentication middleware
function verifyAdminToken(request: NextRequest): boolean {
    const authHeader = request.headers.get("authorization")
    const adminToken = request.headers.get("x-admin-token")

    const expectedToken = process.env.NEXT_PUBLIC_ADMIN_SECRET_TOKEN

    if (!expectedToken) {
        console.error("ADMIN_SECRET_TOKEN not configured")
        return false
    }

    // Check Authorization header
    if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.split("Bearer ")[1]
        return token === expectedToken
    }

    // Check x-admin-token header
    if (adminToken === expectedToken) {
        return true
    }

    console.log("Token verification failed:", { authHeader, adminToken, expectedToken })
    return false
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url)
        const category = searchParams.get("category")
        const pageSize = Number.parseInt(searchParams.get("limit") || "20")

        let q = query(collection(db, "products"), orderBy("createdAt", "desc"))

        if (category) {
            q = query(q, where("category", "==", category))
        }

        q = query(q, limit(pageSize))

        const snapshot = await getDocs(q)
        const products = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as Product[]

        return NextResponse.json({
            success: true,
            products,
            total: products.length,
        })
    } catch (error) {
        console.error("Error fetching products:", error)
        return NextResponse.json({ error: "Failed to fetch products" }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    try {
        console.log("POST /api/admin/products - Starting request")

        // Verify admin authentication
        if (!verifyAdminToken(request)) {
            console.log("Admin token verification failed")
            return NextResponse.json({ error: "Unauthorized: Invalid admin token" }, { status: 401 })
        }

        console.log("Admin token verified successfully")

        const body = await request.json()
        console.log("Request body received:", body)

        // Validate required fields
        const requiredFields = ["name", "description", "price", "category"]
        for (const field of requiredFields) {
            if (!body[field]) {
                console.log(`Missing required field: ${field}`)
                return NextResponse.json({ error: `Missing required field: ${field}` }, { status: 400 })
            }
        }

        // Validate price
        if (typeof body.price !== "number" || body.price <= 0) {
            console.log("Invalid price:", body.price)
            return NextResponse.json({ error: "Price must be a positive number" }, { status: 400 })
        }

        // Prepare product data
        const productData = {
            name: body.name,
            description: body.description,
            price: body.price,
            category: body.category,
            subcategory: body.subcategory || body.category,
            image: body.image || "/placeholder.svg?height=300&width=300",
            images: body.images || [body.image || "/placeholder.svg?height=300&width=300"],
            inStock: body.inStock !== false, // Default to true
            rating: body.rating || 0,
            reviews: body.reviews || 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        }

        console.log("Prepared product data:", productData)
        console.log("Attempting to add to Firestore...")

        // Add to Firestore
        const docRef = await addDoc(collection(db, "products"), productData)
        console.log("Product created successfully with ID:", docRef.id)

        return NextResponse.json({
            success: true,
            productId: docRef.id,
            message: "Product created successfully",
        })
    } catch (error) {
        console.error("Error in POST /api/admin/products:", error)

        // Check if it's a Firebase error
        if (error && typeof error === "object" && "code" in error) {
            const firebaseError = error as any
            console.error("Firebase error details:", {
                code: firebaseError.code,
                message: firebaseError.message,
                details: firebaseError,
            })

            if (firebaseError.code === "permission-denied") {
                return NextResponse.json(
                    {
                        error: "Permission denied: Check Firebase security rules",
                        details: "The current user does not have permission to write to the products collection",
                    },
                    { status: 403 },
                )
            }
        }

        return NextResponse.json(
            {
                error: "Internal server error",
                details: error instanceof Error ? error.message : "Unknown error",
            },
            { status: 500 },
        )
    }
}
