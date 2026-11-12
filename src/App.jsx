import { useEffect, useMemo, useState } from "react";
import Admin from "./Admin";
import { supabase } from "./supabase";
import {
  findDeliverySetting,
  getDeliveryZoneKey,
  getValidDeliveryCharge,
} from "./deliverySettings";
import "./App.css";

const money = (amount) =>
  "৳" + Number(amount || 0).toLocaleString("en-BD");

function BannerSlot({ banners, slot, fallbackTitle }) {
  const [activeIndex, setActiveIndex] = useState(0);

  const items = banners.filter(
    (banner) => banner.slot === slot && banner.is_active
  );

  useEffect(() => {
    if (items.length < 2) return;

    const timer = setInterval(() => {
      setActiveIndex((current) => (current + 1) % items.length);
    }, 5000);

    return () => clearInterval(timer);
  }, [items.length]);

  if (!items.length) {
    return (
      <div
        style={{
          width: "100%",
          minHeight: 230,
          borderRadius: 20,
          background: "linear-gradient(135deg,#d9f3e2,#a9dfbd)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          color: "#075b37",
          padding: 24,
          textAlign: "center",
          boxSizing: "border-box",
        }}
      >
        <strong style={{ fontSize: 26 }}>{fallbackTitle}</strong>
        <span style={{ marginTop: 8 }}>New offers coming soon</span>
      </div>
    );
  }

  const banner = items[activeIndex % items.length];

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        minHeight: 230,
        borderRadius: 20,
        overflow: "hidden",
        background: "#e5f4e9",
      }}
    >
      <img
        src={banner.image_url}
        alt={banner.title || fallbackTitle}
        style={{
          width: "100%",
          height: "100%",
          minHeight: 230,
          objectFit: "cover",
          display: "block",
        }}
      />

      {(banner.title || banner.description || banner.button_text) && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            alignItems: "flex-start",
            padding: 24,
            color: "#fff",
            background:
              "linear-gradient(0deg,rgba(0,0,0,.68),transparent 72%)",
          }}
        >
          {banner.title && (
            <h2 style={{ margin: "0 0 6px", color: "#fff" }}>
              {banner.title}
            </h2>
          )}

          {banner.description && (
            <p style={{ margin: "0 0 12px", maxWidth: 500 }}>
              {banner.description}
            </p>
          )}

          {banner.button_text && (
            <a
              href={banner.button_link || "#products"}
              style={{
                background: "#fff",
                color: "#087344",
                padding: "10px 18px",
                borderRadius: 9,
                textDecoration: "none",
                fontWeight: 700,
              }}
            >
              {banner.button_text}
            </a>
          )}
        </div>
      )}

      {items.length > 1 && (
        <div
          style={{
            position: "absolute",
            right: 14,
            top: 14,
            display: "flex",
            gap: 6,
          }}
        >
          <button
            aria-label="Previous banner"
            onClick={() =>
              setActiveIndex(
                (activeIndex - 1 + items.length) % items.length
              )
            }
            style={bannerNavStyle}
          >
            ‹
          </button>

          <button
            aria-label="Next banner"
            onClick={() =>
              setActiveIndex((activeIndex + 1) % items.length)
            }
            style={bannerNavStyle}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}

const bannerNavStyle = {
  width: 34,
  height: 34,
  border: 0,
  borderRadius: "50%",
  background: "rgba(255,255,255,.92)",
  color: "#075b37",
  fontSize: 24,
  cursor: "pointer",
};

function Storefront() {
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productError, setProductError] = useState("");
  const [banners, setBanners] = useState([]);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");

  const [cart, setCart] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [orderInfo, setOrderInfo] = useState(null);
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [deliverySettings, setDeliverySettings] = useState([]);
  const [deliverySettingsLoading, setDeliverySettingsLoading] = useState(true);
  const [deliverySettingsError, setDeliverySettingsError] = useState("");
  const [district, setDistrict] = useState("");

  // Load products and banners from Supabase
  useEffect(() => {
    async function loadProducts() {
      setLoadingProducts(true);
      setProductError("");

      const { data: bannerData, error: bannerError } = await supabase
        .from("offer_banners")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (bannerError) {
        console.error("Banner load error:", bannerError);
      }

      setBanners(bannerData || []);

      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("is_published", true)
        .order("id", { ascending: false });

      if (error) {
        console.error(error);
        setProductError(error.message);
      } else {
        setProducts(data || []);
      }

      setLoadingProducts(false);
    }

    loadProducts();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadDeliverySettings() {
      setDeliverySettingsLoading(true);
      setDeliverySettingsError("");

      try {
        const { data, error } = await supabase
          .from("delivery_settings")
          .select("district, delivery_charge")
          .eq("is_active", true);

        if (error) throw error;
        if (!cancelled) setDeliverySettings(data || []);
      } catch (error) {
        if (!cancelled) {
          setDeliverySettingsError(
            error.message || "Delivery charges could not be loaded."
          );
        }
      } finally {
        if (!cancelled) setDeliverySettingsLoading(false);
      }
    }

    loadDeliverySettings();
    return () => {
      cancelled = true;
    };
  }, []);

  // Categories
  const categories = useMemo(() => {
    const names = products
      .map((product) => product.category)
      .filter(Boolean);

    return ["All", ...new Set(names)];
  }, [products]);

  // Filter products
  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const matchesSearch = String(product.name || "")
        .toLowerCase()
        .includes(search.toLowerCase());

      const matchesCategory =
        category === "All" || product.category === category;

      return matchesSearch && matchesCategory;
    });
  }, [products, search, category]);

  // Cart calculations
  const totalItems = cart.reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  const subtotal = cart.reduce(
    (sum, item) =>
      sum + Number(item.price || 0) * item.quantity,
    0
  );

  const deliveryZoneKey = district.trim()
    ? getDeliveryZoneKey(district)
    : null;
  const selectedDeliverySetting = deliveryZoneKey
    ? findDeliverySetting(deliverySettings, deliveryZoneKey)
    : null;
  const delivery = getValidDeliveryCharge(selectedDeliverySetting);

  const total = subtotal + (delivery ?? 0);

  // Add to cart
  const addToCart = (product) => {
    const stock = Number(product.stock || 0);

    if (stock <= 0) {
      alert("Sorry! This product is out of stock.");
      return;
    }

    setCart((current) => {
      const existing = current.find(
        (item) => item.id === product.id
      );

      if (existing) {
        if (existing.quantity >= stock) {
          alert("Maximum available stock reached.");
          return current;
        }

        return current.map((item) =>
          item.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }

      return [...current, { ...product, quantity: 1 }];
    });

    setSelectedProduct(null);
    setCartOpen(true);
  };

  // Change quantity
  const changeQuantity = (id, amount) => {
    setCart((current) =>
      current
        .map((item) => {
          if (item.id !== id) return item;

          const newQuantity = item.quantity + amount;

          if (newQuantity > Number(item.stock || 0)) {
            return item;
          }

          return { ...item, quantity: newQuantity };
        })
        .filter((item) => item.quantity > 0)
    );
  };

  // Remove item
  const removeFromCart = (id) => {
    setCart((current) =>
      current.filter((item) => item.id !== id)
    );
  };

  // Submit order
  const handleOrder = async (e) => {
    e.preventDefault();

    if (orderSubmitting) return;

    setOrderError("");

    if (!cart.length) {
      setOrderError("Your shopping bag is empty.");
      return;
    }

    const formData = new FormData(e.currentTarget);

    const orderPayload = {
      name: String(formData.get("name") || "").trim(),
      phone: String(formData.get("phone") || "").trim(),
      email: String(formData.get("email") || "").trim(),
      district: String(formData.get("district") || "").trim(),
      address: String(formData.get("address") || "").trim(),
      delivery_charge: delivery,
      payment: String(
        formData.get("payment") || "Cash on Delivery"
      ),
      items: cart.map((item) => ({
        product_id: Number(item.id),
        quantity: Number(item.quantity),
      })),
    };

    if (
      !orderPayload.name ||
      !orderPayload.phone ||
      !orderPayload.district ||
      !orderPayload.address
    ) {
      setOrderError("Please fill in all required fields.");
      return;
    }

    if (!/^01[0-9]{9}$/.test(orderPayload.phone)) {
      setOrderError("Enter a valid Bangladesh phone number.");
      return;
    }

    if (deliverySettingsLoading) {
      setOrderError("Delivery charges are still loading. Please wait.");
      return;
    }

    if (deliverySettingsError) {
      setOrderError(
        "Delivery charges are unavailable. Please try again later."
      );
      return;
    }

    if (delivery === null) {
      setOrderError(
        "A delivery charge is not configured for the selected district."
      );
      return;
    }

    setOrderSubmitting(true);

    try {
      const { data, error } = await supabase.functions.invoke(
        "order-notification",
        {
          body: orderPayload,
        }
      );

      if (error) {
        throw new Error(error.message || "Order submission failed.");
      }

      if (!data?.success || !data?.orderId) {
        throw new Error(
          data?.error || "Could not confirm your order."
        );
      }

      setOrderInfo({
        orderId: data.orderId,
        name: orderPayload.name,
        phone: orderPayload.phone,
        district: orderPayload.district,
        delivery_charge: delivery,
        items: totalItems,
        total: Number(data.total ?? total),
        payment: orderPayload.payment,
      });

      // Update local stock
      setProducts((current) =>
        current.map((product) => {
          const ordered = cart.find(
            (item) => item.id === product.id
          );

          if (!ordered) return product;

          return {
            ...product,
            stock: Math.max(
              0,
              Number(product.stock || 0) - ordered.quantity
            ),
          };
        })
      );

      setOrderPlaced(true);
      setCart([]);
    } catch (error) {
      console.error("Order error:", error);
      setOrderError(
        error.message || "Something went wrong. Try again."
      );
    } finally {
      setOrderSubmitting(false);
    }
  };

  // Reset checkout
  const closeCheckout = () => {
    setCheckoutOpen(false);
    setOrderPlaced(false);
    setOrderInfo(null);
    setOrderError("");
    setDistrict("");
  };

  return (
    <div className="app">
      {/* NAVBAR */}
      <header className="navbar">
        <div className="nav-container">
          {/* CRS LOGO */}
          <a href="#" className="logo">
            <img
              src="/crs-logo.jpeg"
              alt="Cumilla Recycle Shop Logo"
              style={{
                width: "65px",
                height: "65px",
                objectFit: "contain",
                borderRadius: "8px",
              }}
            />
          </a>

          <nav className="nav-links">
            <a href="#">Home</a>
            <a href="#products">Products</a>
            <a href="#features">About</a>
            <a href="#contact">Contact</a>
          </nav>

          <div className="nav-actions">
            <a href="#products" className="nav-order-button">
              Order Now
            </a>

            <button
              className={`cart-button ${
                totalItems > 0 ? "has-items" : ""
              }`}
              onClick={() => setCartOpen(true)}
              aria-label={`Open shopping bag, ${totalItems} items`}
            >
              <span className="cart-icon">🛍️</span>
              <span>My Bag</span>
              <span className="cart-count">{totalItems}</span>
            </button>
          </div>
        </div>
      </header>

      <main>
        {/* HOT OFFER BANNER */}
        <section style={{ padding: "28px 5.3% 12px" }}>
          <BannerSlot
            banners={banners}
            slot="hot_offer"
            fallbackTitle="HOT OFFER"
          />
        </section>

        {/* HERO */}
        <section className="hero">
          <div className="hero-content">
            <span className="hero-label">
              ♻ SMART SHOPPING, BETTER FUTURE
            </span>

            <h1>
              Give Products
              <br />
              A <span>Second Life.</span>
            </h1>

            <p>
              Discover quality recycled and reusable products
              at affordable prices. Shop smarter and support
              a greener future.
            </p>

            <div className="hero-buttons">
              <a href="#products" className="primary-button">
                Explore Products →
              </a>

              <a href="#features" className="secondary-button">
                Learn More
              </a>
            </div>

            <div className="hero-stats">
              <div>
                <strong>{products.length}+</strong>
                <span>Products</span>
              </div>

              <div>
                <strong>100%</strong>
                <span>Eco Friendly</span>
              </div>

              <div>
                <strong>Local</strong>
                <span>Cumilla Shop</span>
              </div>
            </div>
          </div>

          {/* BIG DEAL BANNER */}
          <div
            className="hero-image"
            style={{ display: "block", padding: 0 }}
          >
            <BannerSlot
              banners={banners}
              slot="big_deal"
              fallbackTitle="BIG DEAL"
            />
          </div>
        </section>

        {/* PRODUCTS */}
        <section className="products-section" id="products">
          <div className="section-heading">
            <span>OUR COLLECTION</span>
            <h2>Explore Our Products</h2>
            <p>
              Find something useful at a great price.
            </p>
          </div>

          <div className="product-controls">
            <input
              type="search"
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search products"
            />

            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Filter by category"
            >
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          {loadingProducts && (
            <div className="loading-message">
              Loading products...
            </div>
          )}

          {productError && (
            <div className="error-message">
              Could not load products: {productError}
            </div>
          )}

          {!loadingProducts &&
            !productError &&
            filteredProducts.length === 0 && (
              <div className="empty-products">
                <span>🔎</span>
                <h3>No Products Found</h3>
                <p>Try another search or category.</p>
              </div>
            )}

          <div className="products-grid">
            {filteredProducts.map((product) => (
              <article className="product-card" key={product.id}>
                <button
                  className="product-image"
                  onClick={() => setSelectedProduct(product)}
                  aria-label={`View ${product.name}`}
                >
                  {product.image_url || product.image ? (
                    <img
                      src={product.image_url || product.image}
                      alt={product.name}
                    />
                  ) : (
                    <span className="no-image">♻</span>
                  )}

                  {Number(product.stock) <= 0 && (
                    <span className="stock-badge">
                      Out of Stock
                    </span>
                  )}
                </button>

                <div className="product-info">
                  <span className="product-category">
                    {product.category || "General"}
                  </span>

                  <h3>{product.name}</h3>

                  <div className="product-price">
                    <strong>{money(product.price)}</strong>
                  </div>

                  <p className="product-stock">
                    {Number(product.stock) > 0
                      ? `${product.stock} available`
                      : "Currently unavailable"}
                  </p>

                  <div className="product-actions">
                    <button
                      className="add-cart-button"
                      disabled={Number(product.stock) <= 0}
                      onClick={() => addToCart(product)}
                    >
                      Add to Bag +
                    </button>

                    <button
                      className="view-product-button"
                      onClick={() => setSelectedProduct(product)}
                      aria-label="View product details"
                    >
                      View
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* NEWSLETTER */}
        <section className="newsletter-section">
          <div>
            <span>STAY CONNECTED</span>
            <h2>Discover More. Waste Less.</h2>
            <p>
              Shop with purpose and make every purchase count.
            </p>
          </div>

          <a href="#products" className="primary-button">
            Start Shopping →
          </a>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="footer" id="contact">
        <div className="footer-content">
          <div className="footer-brand">
            {/* CRS LOGO */}
            <a href="#" className="logo">
              <img
                src="/crs-logo.jpeg"
                alt="Cumilla Recycle Shop Logo"
                style={{
                  width: "90px",
                  height: "90px",
                  objectFit: "contain",
                  borderRadius: "8px",
                }}
              />
            </a>

            <p>
              Giving useful products a second life.
              Shop smart, save money and support a greener future.
            </p>
          </div>

          <div className="footer-links">
            <h3>Quick Links</h3>
            <a href="#">Home</a>
            <a href="#products">Products</a>
            <a href="#features">About Us</a>
            <a href="#contact">Contact</a>
          </div>

          <div className="footer-links">
            <h3>Customer Support</h3>
            <a href="#products">Shop Now</a>
            <a href="#contact">Contact Us</a>
            <a href="/admin">Admin Login</a>
          </div>
        </div>

        <div className="footer-bottom">
          <p>
            © {new Date().getFullYear()} Cumilla Recycle Shop.
            All rights reserved.
          </p>
          <span>♻ Reduce • Reuse • Recycle</span>
        </div>
      </footer>

      {/* PRODUCT DETAILS MODAL */}
      {selectedProduct && (
        <div
          className="modal-overlay"
          onClick={() => setSelectedProduct(null)}
        >
          <div
            className="product-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              onClick={() => setSelectedProduct(null)}
            >
              ×
            </button>

            <div className="modal-product-image">
              {selectedProduct.image_url ||
              selectedProduct.image ? (
                <img
                  src={
                    selectedProduct.image_url ||
                    selectedProduct.image
                  }
                  alt={selectedProduct.name}
                />
              ) : (
                <span>♻</span>
              )}
            </div>

            <div className="modal-product-info">
              <span>
                {selectedProduct.category || "General"}
              </span>

              <h2>{selectedProduct.name}</h2>

              <h3>{money(selectedProduct.price)}</h3>

              <p>
                {selectedProduct.description ||
                  "A quality product from Cumilla Recycle Shop."}
              </p>

              <p>
                Stock: {selectedProduct.stock || 0}
              </p>

              <button
                className="primary-button"
                disabled={Number(selectedProduct.stock) <= 0}
                onClick={() => addToCart(selectedProduct)}
              >
                Add to Bag
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SHOPPING CART */}
      {cartOpen && (
        <div
          className="modal-overlay cart-overlay"
          onClick={() => setCartOpen(false)}
        >
          <div
            className="cart-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cart-header">
              <div>
                <span>YOUR SHOPPING</span>
                <h2>My Bag ({totalItems})</h2>
              </div>

              <button
                className="modal-close"
                onClick={() => setCartOpen(false)}
              >
                ×
              </button>
            </div>

            {cart.length === 0 ? (
              <div className="empty-cart">
                <span>🛍️</span>
                <h3>Your bag is empty</h3>
                <p>Add some products to get started.</p>

                <button
                  className="primary-button"
                  onClick={() => setCartOpen(false)}
                >
                  Continue Shopping
                </button>
              </div>
            ) : (
              <>
                <div className="cart-items">
                  {cart.map((item) => (
                    <div className="cart-item" key={item.id}>
                      <div className="cart-item-image">
                        {item.image_url || item.image ? (
                          <img
                            src={item.image_url || item.image}
                            alt={item.name}
                          />
                        ) : (
                          <span>♻</span>
                        )}
                      </div>

                      <div className="cart-item-info">
                        <h3>{item.name}</h3>
                        <strong>{money(item.price)}</strong>

                        <div className="quantity-controls">
                          <button
                            onClick={() =>
                              changeQuantity(item.id, -1)
                            }
                          >
                            −
                          </button>

                          <span>{item.quantity}</span>

                          <button
                            onClick={() =>
                              changeQuantity(item.id, 1)
                            }
                          >
                            +
                          </button>
                        </div>
                      </div>

                      <button
                        className="remove-item"
                        onClick={() => removeFromCart(item.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>

                <div className="cart-summary">
                  <div>
                    <span>Subtotal</span>
                    <strong>{money(subtotal)}</strong>
                  </div>

                  <div>
                    <span>Delivery</span>
                    <strong>
                      {delivery === null
                        ? deliverySettingsLoading
                          ? "Loading..."
                          : deliverySettingsError
                            ? "Unavailable"
                            : "Calculated at checkout"
                        : delivery === 0
                          ? "FREE"
                          : money(delivery)}
                    </strong>
                  </div>

                  <div className="cart-total">
                    <span>Total</span>
                    <strong>
                      {delivery === null
                        ? "Calculated at checkout"
                        : money(total)}
                    </strong>
                  </div>

                  <p>
                    Delivery charge is based on your delivery district.
                  </p>

                  <button
                    className="checkout-button"
                    onClick={() => {
                      setCartOpen(false);
                      setCheckoutOpen(true);
                    }}
                  >
                    Proceed to Checkout →
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* CHECKOUT */}
      {checkoutOpen && (
        <div className="modal-overlay checkout-overlay">
          <div className="checkout-modal">
            <div className="checkout-header">
              <div>
                <span>ALMOST THERE</span>
                <h2>Checkout</h2>
              </div>

              <button
                className="modal-close"
                onClick={closeCheckout}
              >
                ×
              </button>
            </div>

            {orderPlaced && orderInfo ? (
              <div className="order-success">
                <div className="success-icon">✓</div>

                <h2>Order Placed Successfully!</h2>

                <p>
                  Thank you for shopping with Cumilla Recycle Shop.
                </p>

                <div className="order-details">
                  <div>
                    <span>Order ID</span>
                    <strong>{orderInfo.orderId}</strong>
                  </div>

                  <div>
                    <span>Name</span>
                    <strong>{orderInfo.name}</strong>
                  </div>

                  <div>
                    <span>Phone</span>
                    <strong>{orderInfo.phone}</strong>
                  </div>

                  <div>
                    <span>District</span>
                    <strong>{orderInfo.district}</strong>
                  </div>

                  <div>
                    <span>Delivery Charge</span>
                    <strong>{money(orderInfo.delivery_charge)}</strong>
                  </div>

                  <div>
                    <span>Items</span>
                    <strong>{orderInfo.items}</strong>
                  </div>

                  <div>
                    <span>Total</span>
                    <strong>{money(orderInfo.total)}</strong>
                  </div>

                  <div>
                    <span>Payment</span>
                    <strong>{orderInfo.payment}</strong>
                  </div>

                  <div>
                    <span>Status</span>
                    <strong>Pending</strong>
                  </div>
                </div>

                <button
                  className="checkout-button"
                  onClick={closeCheckout}
                >
                  Continue Shopping
                </button>
              </div>
            ) : (
              <form
                className="checkout-form"
                onSubmit={handleOrder}
              >
                <h3>Delivery Information</h3>

                <label>
                  Full Name *
                  <input
                    type="text"
                    name="name"
                    placeholder="Enter your full name"
                    required
                  />
                </label>

                <label>
                  Phone Number *
                  <input
                    type="tel"
                    name="phone"
                    placeholder="01XXXXXXXXX"
                    pattern="01[0-9]{9}"
                    maxLength="11"
                    required
                  />
                </label>

                <label>
                  Email Address
                  <input
                    type="email"
                    name="email"
                    placeholder="your@email.com"
                  />
                </label>

                <label>
                  District *
                  <input
                    type="text"
                    name="district"
                    placeholder="Enter your district"
                    value={district}
                    onChange={(e) => {
                      setDistrict(e.target.value);
                      setOrderError("");
                    }}
                    required
                  />
                </label>

                <label>
                  Full Delivery Address *
                  <textarea
                    name="address"
                    placeholder="House, road, area and other details"
                    rows="3"
                    required
                  />
                </label>

                <h3>Payment Method</h3>

                <label className="payment-option">
                  <input
                    type="radio"
                    name="payment"
                    value="Cash on Delivery"
                    defaultChecked
                  />
                  <span>
                    <strong>Cash on Delivery</strong>
                    <small>Pay when your order arrives.</small>
                  </span>
                </label>

                {deliverySettingsLoading && (
                  <p className="checkout-note">Loading delivery charges...</p>
                )}

                {deliverySettingsError && (
                  <div className="error-message">
                    Delivery charges could not be loaded. Checkout is unavailable.
                  </div>
                )}

                {!deliverySettingsLoading &&
                  !deliverySettingsError &&
                  district.trim() &&
                  delivery === null && (
                    <div className="error-message">
                      No active delivery charge is configured for this district.
                    </div>
                  )}

                <div className="checkout-total">
                  <span>Subtotal</span>
                  <strong>{money(subtotal)}</strong>
                </div>

                <div className="checkout-total">
                  <span>Delivery Charge</span>
                  <strong>
                    {delivery === null
                      ? district.trim()
                        ? "Unavailable"
                        : "Enter district"
                      : delivery === 0
                        ? "FREE"
                        : money(delivery)}
                  </strong>
                </div>

                <div className="checkout-total grand-total">
                  <span>Total Amount</span>
                  <strong>{delivery === null ? "—" : money(total)}</strong>
                </div>

                {orderError && (
                  <div className="error-message">
                    {orderError}
                  </div>
                )}

                <button
                  type="submit"
                  className="checkout-button"
                  disabled={
                    orderSubmitting ||
                    cart.length === 0 ||
                    deliverySettingsLoading ||
                    Boolean(deliverySettingsError) ||
                    delivery === null
                  }
                >
                  {orderSubmitting
                    ? "Placing Your Order..."
                    : deliverySettingsLoading
                      ? "Loading delivery charges..."
                      : deliverySettingsError || delivery === null
                        ? "Checkout unavailable"
                        : `Confirm Order — ${money(total)}`}
                </button>

                <p className="checkout-note">
                  Your order will be submitted securely.
                </p>
              </form>
            )}
          </div>
        </div>
      )}

      {/* FLOATING WHATSAPP CONTACT BUTTON */}
      <a
        href="https://wa.me/8801961848828?text=Hello%2C%20I%20want%20to%20know%20about%20your%20products."
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat with Cumilla Recycle Shop on WhatsApp"
        title="Chat with us on WhatsApp"
        style={{
          position: "fixed",
          right: "24px",
          bottom: "24px",
          width: "58px",
          height: "58px",
          borderRadius: "50%",
          backgroundColor: "#25D366",
          color: "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
          zIndex: 9999,
          textDecoration: "none",
        }}
      >
        <svg
          viewBox="0 0 32 32"
          width="34"
          height="34"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M16.01 3C8.85 3 3.02 8.78 3.02 15.9c0 2.28.6 4.5 1.75 6.46L3 29l6.84-1.78a13.1 13.1 0 0 0 6.17 1.55h.01c7.16 0 12.99-5.79 12.99-12.9C29.01 8.77 23.18 3 16.01 3Zm0 23.58h-.01a10.9 10.9 0 0 1-5.55-1.51l-.4-.24-4.06 1.06 1.08-3.94-.26-.41a10.67 10.67 0 0 1-1.65-5.64c0-5.95 4.88-10.79 10.86-10.79 2.9 0 5.63 1.12 7.68 3.16a10.68 10.68 0 0 1 3.18 7.63c0 5.95-4.88 10.79-10.87 10.79Zm5.96-8.08c-.33-.16-1.94-.95-2.24-1.06-.3-.11-.52-.16-.74.16-.22.32-.85 1.06-1.04 1.28-.19.21-.38.24-.71.08-.33-.16-1.4-.51-2.67-1.63-.99-.87-1.66-1.94-1.85-2.27-.19-.32-.02-.5.14-.66.15-.14.33-.38.49-.57.16-.19.22-.32.33-.54.11-.21.06-.4-.03-.56-.08-.16-.74-1.77-1.01-2.42-.27-.64-.54-.55-.74-.56h-.63c-.22 0-.57.08-.87.4-.3.32-1.14 1.11-1.14 2.7s1.17 3.13 1.33 3.34c.16.21 2.3 3.5 5.57 4.9.78.33 1.39.53 1.86.68.78.25 1.49.22 2.05.13.63-.1 1.94-.79 2.21-1.55.27-.76.27-1.41.19-1.55-.08-.14-.3-.22-.63-.38Z" />
        </svg>
      </a>
    </div>
  );
}

function App() {
  if (window.location.pathname === "/admin") {
    return <Admin />;
  }

  return <Storefront />;
}

export default App;