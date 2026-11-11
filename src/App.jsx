
import { useEffect, useMemo, useState } from "react";
import Admin from "./Admin";
import { supabase } from "./supabase";
import "./App.css";

const money = (amount) =>
  "৳" + Number(amount || 0).toLocaleString("en-BD");

function App() {
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productError, setProductError] = useState("");

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

  // Admin page
  if (window.location.pathname === "/admin") {
    return <Admin />;
  }

  // Load products from Supabase
  useEffect(() => {
    async function loadProducts() {
      setLoadingProducts(true);
      setProductError("");

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

  const delivery =
    subtotal === 0 || subtotal >= 3000 ? 0 : 80;

  const total = subtotal + delivery;

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
  };

  return (
    <div className="app">

      {/* NAVBAR */}
      <header className="navbar">
        <div className="nav-container">
          <a href="#" className="logo">
            <span className="logo-icon">♻</span>
            <span>
              <strong>CUMILLA</strong>
              <small>RECYCLE SHOP</small>
            </span>
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

        {/* BIG DEALS BANNER */}
        <section className="big-deals-banner">
          <div className="big-deals-content">
            <span className="big-deals-label">
              ✦ SPECIAL OFFERS
            </span>

            <h2>BIG DEALS</h2>

            <h3>Great Products. Better Prices.</h3>

            <p>
              Discover amazing deals and shop your favourite
              products at Cumilla Recycle Shop.
            </p>

            <a href="#products" className="big-deals-button">
              SHOP NOW <span>→</span>
            </a>
          </div>

          <div className="big-deals-decoration">
            <span>BIG</span>
            <strong>DEALS</strong>
            <small>SHOP • SAVE • REPEAT</small>
          </div>
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

          <div className="hero-image">
            <div className="hero-image-circle">
              <span>♻</span>
            </div>

            <div className="hero-floating-card">
              <span>🌱</span>
              <div>
                <strong>Go Green</strong>
                <small>Shop Sustainably</small>
              </div>
            </div>
          </div>
        </section>

        {/* FEATURES */}
        <section className="features-section" id="features">
          <div className="section-heading">
            <span>WHY CHOOSE US</span>
            <h2>Shopping Made Better</h2>
            <p>
              Quality products, affordable prices and a
              sustainable shopping experience.
            </p>
          </div>

          <div className="features-grid">
            <div className="feature-card">
              <span>🌿</span>
              <h3>Eco Friendly</h3>
              <p>
                Support recycling and help reduce unnecessary waste.
              </p>
            </div>

            <div className="feature-card">
              <span>💰</span>
              <h3>Affordable Price</h3>
              <p>
                Find useful products at prices that make sense.
              </p>
            </div>

            <div className="feature-card">
              <span>🚚</span>
              <h3>Easy Delivery</h3>
              <p>
                Order online and get your products delivered.
              </p>
            </div>

            <div className="feature-card">
              <span>🔒</span>
              <h3>Easy Ordering</h3>
              <p>
                Simple checkout with Cash on Delivery option.
              </p>
            </div>
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
            <a href="#" className="logo">
              <span className="logo-icon">♻</span>
              <span>
                <strong>CUMILLA</strong>
                <small>RECYCLE SHOP</small>
              </span>
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
                      {delivery === 0 ? "FREE" : money(delivery)}
                    </strong>
                  </div>

                  <div className="cart-total">
                    <span>Total</span>
                    <strong>{money(total)}</strong>
                  </div>

                  <p>
                    Free delivery on orders above ৳3,000.
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

                <div className="checkout-total">
                  <span>Subtotal</span>
                  <strong>{money(subtotal)}</strong>
                </div>

                <div className="checkout-total">
                  <span>Delivery Charge</span>
                  <strong>
                    {delivery === 0 ? "FREE" : money(delivery)}
                  </strong>
                </div>

                <div className="checkout-total grand-total">
                  <span>Total Amount</span>
                  <strong>{money(total)}</strong>
                </div>

                {orderError && (
                  <div className="error-message">
                    {orderError}
                  </div>
                )}

                <button
                  type="submit"
                  className="checkout-button"
                  disabled={orderSubmitting || cart.length === 0}
                >
                  {orderSubmitting
                    ? "Placing Your Order..."
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

    </div>
  );
}

export default App;
