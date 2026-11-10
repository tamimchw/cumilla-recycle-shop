
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

  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");

  const [cart, setCart] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [orderInfo, setOrderInfo] = useState(null);
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [orderError, setOrderError] = useState("");

  // Load published products from Supabase
  useEffect(() => {
    async function loadProducts() {
      setLoadingProducts(true);
      setProductError("");

      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("is_published", true)
        .order("id", { ascending: true });

      if (error) {
        console.error("Product loading error:", error);
        setProductError(error.message);
      } else {
        setProducts(
          (data || []).map((product) => ({
            ...product,
            image: product.image_url,
            oldPrice: 0,
            tag: "NEW",
          }))
        );
      }

      setLoadingProducts(false);
    }

    loadProducts();
  }, []);

  // Search and category filter
  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const matchesCategory =
        category === "All" || product.category === category;

      const matchesSearch = product.name
        .toLowerCase()
        .includes(search.toLowerCase());

      return matchesCategory && matchesSearch;
    });
  }, [products, category, search]);

  // Add to cart
  const addToCart = (product) => {
    if (Number(product.stock) <= 0) {
      alert("Sorry! This product is out of stock.");
      return;
    }

    setCart((current) => {
      const existing = current.find(
        (item) => item.id === product.id
      );

      if (existing) {
        if (existing.quantity >= Number(product.stock)) {
          alert("Sorry! Maximum available stock reached.");
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
  };

  // Change quantity
  const changeQuantity = (id, amount) => {
    setCart((current) =>
      current
        .map((item) => {
          if (item.id !== id) return item;

          const newQuantity = item.quantity + amount;

          if (newQuantity > Number(item.stock)) {
            return item;
          }

          return { ...item, quantity: newQuantity };
        })
        .filter((item) => item.quantity > 0)
    );
  };

  // Remove product
  const removeFromCart = (id) => {
    setCart((current) =>
      current.filter((item) => item.id !== id)
    );
  };

  // Cart calculations
  const totalItems = cart.reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  const subtotal = cart.reduce(
    (sum, item) => sum + Number(item.price) * item.quantity,
    0
  );

  const delivery =
    subtotal === 0 || subtotal >= 3000 ? 0 : 80;

  const total = subtotal + delivery;

  // Real order submission through the secure Edge Function
  const handleOrder = async (e) => {
    e.preventDefault();
    setOrderError("");

    if (orderSubmitting) return;

    if (cart.length === 0) {
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

    setOrderSubmitting(true);

    try {
      const { data, error } = await supabase.functions.invoke(
        "order-notification",
        { body: orderPayload }
      );

      if (error) {
        let message =
          error.message || "Could not submit your order.";

        try {
          const details = await error.context?.json?.();
          if (details?.error) message = details.error;
        } catch {
          // Keep original error message.
        }

        throw new Error(message);
      }

      if (!data?.success || !data?.orderId) {
        throw new Error(
          data?.error ||
          "Order could not be confirmed. Please try again."
        );
      }

      setOrderInfo({
        orderId: data.orderId,
        name: orderPayload.name,
        phone: orderPayload.phone,
        district: orderPayload.district,
        items: totalItems,
        total: Number(data.total ?? total),
        emailSent: Boolean(data.emailSent),
      });

      // Update visible stock after successful order.
      setProducts((current) =>
        current.map((product) => {
          const ordered = cart.find(
            (item) => item.id === product.id
          );

          return ordered
            ? {
                ...product,
                stock: Math.max(
                  0,
                  Number(product.stock) -
                    Number(ordered.quantity)
                ),
              }
            : product;
        })
      );

      setOrderPlaced(true);
      setCart([]);
    } catch (error) {
      console.error("Order submission error:", error);
      setOrderError(
        error.message || "Something went wrong. Please try again."
      );
    } finally {
      setOrderSubmitting(false);
    }
  };

  // Admin route
  if (window.location.pathname === "/admin") {
    return <Admin />;
  }

  return (
    <div className="app">

      {/* Announcement */}
      <div className="announcement">
        Free delivery on orders over ৳3,000
      </div>

      {/* Navbar */}
      <header className="navbar">
        <a href="#home" className="logo">
          CUMILLA RECYCLE SHOP<span>.</span>
        </a>

        <nav>
          <a href="#home">Home</a>
          <a href="#products">Shop</a>
          <a href="#categories">Categories</a>
          <a href="#footer">Contact</a>
        </nav>

        <div className="nav-actions">
          <button
            className="cart-button"
            onClick={() => setCartOpen(true)}
          >
            Bag ({totalItems})
          </button>
        </div>
      </header>

      <main>

        {/* Hero */}
        <section className="hero" id="home">
          <div className="hero-content">
            <span className="eyebrow">
              THE NEW COLLECTION 2026
            </span>

            <h1>
              Discover your<br />
              everyday style.
            </h1>

            <p>
              Thoughtfully selected products for your lifestyle.
              Quality, simplicity and elegance in every detail.
            </p>

            <a href="#products" className="primary-button">
              Explore Collection <span>→</span>
            </a>

            <div className="hero-note">
              Curated for everyday living.
            </div>
          </div>

          <div className="hero-image">
            <img
              src="https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1100"
              alt="Modern shopping collection"
            />

            <div className="image-label">
              <span>NEW SEASON</span>
              <strong>Style starts here.</strong>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="features">
          <div>
            <span>01</span>
            <strong>Quality Products</strong>
            <small>Carefully selected</small>
          </div>

          <div>
            <span>02</span>
            <strong>Secure Shopping</strong>
            <small>Shop with confidence</small>
          </div>

          <div>
            <span>03</span>
            <strong>Easy Returns</strong>
            <small>Simple return policy</small>
          </div>

          <div>
            <span>04</span>
            <strong>Fast Delivery</strong>
            <small>Across Bangladesh</small>
          </div>
        </section>

        {/* Products */}
        <section className="shop-section" id="products">

          <div className="section-heading">
            <div>
              <span className="eyebrow">
                OUR COLLECTION
              </span>

              <h2>Shop the essentials.</h2>
              <p>Find something you will love.</p>
            </div>

            <div className="search-box">
              <span>⌕</span>

              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products..."
              />
            </div>
          </div>

          {/* Categories */}
          <div className="category-list" id="categories">
            {["All", "Fashion", "Electronics", "Accessories"].map(
              (item) => (
                <button
                  key={item}
                  className={
                    category === item
                      ? "category active"
                      : "category"
                  }
                  onClick={() => setCategory(item)}
                >
                  {item}
                </button>
              )
            )}
          </div>

          {/* Loading */}
          {loadingProducts && (
            <div className="empty-state">
              Loading products from Cumilla Recycle Shop Database...
            </div>
          )}

          {/* Error */}
          {productError && (
            <div className="empty-state">
              <p>Unable to load products.</p>
              <p>{productError}</p>
              <button
                className="primary-button"
                onClick={() => window.location.reload()}
              >
                Try Again
              </button>
            </div>
          )}

          {/* Product Grid */}
          {!loadingProducts && !productError && (
            <>
              <div className="product-grid">
                {filteredProducts.map((product) => (
                  <article
                    className="product-card"
                    key={product.id}
                  >
                    <div className="product-image">
                      <img
                        src={product.image}
                        alt={product.name}
                        loading="lazy"
                      />

                      <span className="product-tag">
                        {product.tag}
                      </span>

                      <button
                        className="quick-add"
                        onClick={() => addToCart(product)}
                        disabled={Number(product.stock) <= 0}
                      >
                        {Number(product.stock) <= 0
                          ? "Out of Stock"
                          : "+ Add to bag"}
                      </button>
                    </div>

                    <div className="product-info">
                      <div>
                        <span className="product-category">
                          {product.category}
                        </span>

                        <h3
                          className="clickable-product"
                          onClick={() =>
                            setSelectedProduct(product)
                          }
                        >
                          {product.name}
                        </h3>

                        <button
                          className="details-link"
                          onClick={() =>
                            setSelectedProduct(product)
                          }
                        >
                          View details →
                        </button>

                        <small>
                          Stock: {product.stock}
                        </small>
                      </div>

                      <div className="price">
                        <strong>{money(product.price)}</strong>
                      </div>
                    </div>
                  </article>
                ))}
              </div>

              {filteredProducts.length === 0 && (
                <div className="empty-state">
                  No products found. Try another search.
                </div>
              )}
            </>
          )}
        </section>

        {/* Newsletter */}
        <section className="newsletter">
          <span className="eyebrow">
            STAY IN THE LOOP
          </span>

          <h2>Good things are coming.</h2>

          <p>
            Discover new arrivals and exclusive offers.
          </p>

          <a href="#products" className="primary-button">
            Explore Products →
          </a>
        </section>

      </main>

      {/* Footer */}
      <footer id="footer">
        <a href="#home" className="logo">
          cumilla recycle shop<span>.</span>
        </a>

        <p>Simple choices. Better everyday living.</p>

        <small>
          © 2026 CUMILLA RECYCLE SHOP. All rights reserved.
        </small>
      </footer>

      {/* Product Details */}
      {selectedProduct && (
        <div
          className="cart-overlay"
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
              ✕
            </button>

            <img
              src={selectedProduct.image}
              alt={selectedProduct.name}
            />

            <div className="modal-info">
              <span className="product-category">
                {selectedProduct.category}
              </span>

              <h2>{selectedProduct.name}</h2>

              <strong>
                {money(selectedProduct.price)}
              </strong>

              <p>{selectedProduct.description}</p>

              <p>
                Available stock: {selectedProduct.stock}
              </p>

              <button
                className="checkout-button"
                onClick={() => addToCart(selectedProduct)}
                disabled={Number(selectedProduct.stock) <= 0}
              >
                Add to Shopping Bag
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shopping Cart */}
      {cartOpen && (
        <div
          className="cart-overlay"
          onClick={() => setCartOpen(false)}
        >
          <div
            className="cart-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cart-header">
              <h2>
                Your Shopping Bag ({totalItems})
              </h2>

              <button onClick={() => setCartOpen(false)}>
                ✕
              </button>
            </div>

            {cart.length === 0 ? (
              <p className="empty-cart">
                Your shopping bag is empty.
              </p>
            ) : (
              <>
                {cart.map((item) => (
                  <div className="cart-item" key={item.id}>
                    <img
                      src={item.image}
                      alt={item.name}
                    />

                    <div className="cart-item-info">
                      <strong>{item.name}</strong>

                      <p>{money(item.price)}</p>

                      <div className="quantity-control">
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

                      <button
                        className="remove-button"
                        onClick={() =>
                          removeFromCart(item.id)
                        }
                      >
                        Remove
                      </button>
                    </div>

                    <strong className="item-total">
                      {money(item.price * item.quantity)}
                    </strong>
                  </div>
                ))}

                <div className="order-summary">
                  <h3>Order Summary</h3>

                  <div>
                    <span>Subtotal</span>
                    <strong>{money(subtotal)}</strong>
                  </div>

                  <div>
                    <span>Delivery Charge</span>
                    <strong>
                      {delivery === 0
                        ? "FREE"
                        : money(delivery)}
                    </strong>
                  </div>

                  <div className="summary-total">
                    <strong>Total</strong>
                    <strong>{money(total)}</strong>
                  </div>

                  {subtotal > 0 && subtotal < 3000 && (
                    <p className="delivery-note">
                      Add {money(3000 - subtotal)} more
                      for free delivery!
                    </p>
                  )}

                  <button
                    className="checkout-button"
                    onClick={() => {
                      setCartOpen(false);
                      setCheckoutOpen(true);
                      setOrderError("");
                    }}
                  >
                    Continue to Checkout →
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Checkout */}
      {checkoutOpen && (
        <div className="checkout-overlay">
          <div className="checkout-container">

            {!orderPlaced ? (
              <>
                <div className="checkout-heading">
                  <div>
                    <span className="eyebrow">
                      CUMILLA RECYCLE SHOP
                    </span>

                    <h2>Complete your order.</h2>

                    <p>
                      Enter your delivery information below.
                    </p>
                  </div>

                  <button
                    className="modal-close"
                    onClick={() => setCheckoutOpen(false)}
                    disabled={orderSubmitting}
                  >
                    ✕
                  </button>
                </div>

                <form
                  className="checkout-form"
                  onSubmit={handleOrder}
                >
                  {orderError && (
                    <div className="admin-error" role="alert">
                      {orderError}
                    </div>
                  )}

                  <h3>01. Contact Information</h3>

                  <label>Full Name *</label>

                  <input
                    name="name"
                    placeholder="Enter your full name"
                    required
                  />

                  <label>Mobile Number *</label>

                  <input
                    name="phone"
                    type="tel"
                    placeholder="01XXXXXXXXX"
                    pattern="01[0-9]{9}"
                    title="Enter a valid 11-digit Bangladesh mobile number"
                    required
                  />

                  <label>Email Address (Optional)</label>

                  <input
                    name="email"
                    type="email"
                    placeholder="your@email.com"
                  />

                  <h3>02. Delivery Address</h3>

                  <label>District *</label>

                  <input
                    name="district"
                    placeholder="e.g. Cumilla"
                    required
                  />

                  <label>Full Address *</label>

                  <textarea
                    name="address"
                    placeholder="House, Road, Area, Post Office..."
                    rows="4"
                    required
                  />

                  <h3>03. Payment Method</h3>

                  <div className="payment-option">
                    <input
                      type="radio"
                      name="payment"
                      value="Cash on Delivery"
                      defaultChecked
                    />

                    <div>
                      <strong>Cash on Delivery</strong>
                      <p>Pay when your order arrives.</p>
                    </div>
                  </div>

                  <div className="checkout-total">
                    <span>Total Amount</span>
                    <strong>{money(total)}</strong>
                  </div>

                  <button
                    className="checkout-button"
                    type="submit"
                    disabled={orderSubmitting}
                  >
                    {orderSubmitting
                      ? "Placing Order..."
                      : "Place Order →"}
                  </button>

                  <button
                    type="button"
                    className="back-button"
                    disabled={orderSubmitting}
                    onClick={() => {
                      setCheckoutOpen(false);
                      setCartOpen(true);
                    }}
                  >
                    Back to Shopping Bag
                  </button>
                </form>
              </>
            ) : (
              <div className="order-success">

                <div className="success-icon">✓</div>

                <span className="eyebrow">
                  ORDER CONFIRMATION
                </span>

                <h2>
                  Thank you, {orderInfo?.name}!
                </h2>

                <p>
                  Your order has been submitted successfully.
                  We will contact you soon.
                </p>

                {orderInfo?.emailSent === false && (
                  <p>
                    Your order was saved, but the store notification
                    email could not be sent.
                  </p>
                )}

                <div className="success-details">
                  <div>
                    <span>Order ID</span>
                    <strong>CRS-{orderInfo?.orderId}</strong>
                  </div>

                  <div>
                    <span>Order Status</span>
                    <strong>Pending</strong>
                  </div>

                  <div>
                    <span>Mobile Number</span>
                    <strong>{orderInfo?.phone}</strong>
                  </div>

                  <div>
                    <span>Delivery District</span>
                    <strong>{orderInfo?.district}</strong>
                  </div>

                  <div>
                    <span>Items</span>
                    <strong>{orderInfo?.items}</strong>
                  </div>

                  <div>
                    <span>Total Amount</span>
                    <strong>{money(orderInfo?.total)}</strong>
                  </div>

                  <div>
                    <span>Payment</span>
                    <strong>Cash on Delivery</strong>
                  </div>
                </div>

                <button
                  className="checkout-button"
                  onClick={() => {
                    setCheckoutOpen(false);
                    setOrderPlaced(false);
                    setOrderInfo(null);
                    setOrderError("");
                  }}
                >
                  Continue Shopping →
                </button>

              </div>
            )}

          </div>
        </div>
      )}

    </div>
  );
}

export default App;
