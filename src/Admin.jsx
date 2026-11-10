
import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import Barcode from "react-barcode";
import {
  Html5QrcodeScanner,
  Html5QrcodeSupportedFormats,
} from "html5-qrcode";
import { supabase } from "./supabase";
import "./Admin.css";

const money = (amount) =>
  "৳" +
  Number(amount || 0).toLocaleString("en-BD", {
    maximumFractionDigits: 2,
  });

const emptyProduct = {
  name: "",
  description: "",
  category: "Plastic",
  price: "",
  stock: "",
  image_url: "",
};

const emptyPurchase = {
  purchase_date: new Date().toISOString().slice(0, 10),
  product_name: "",
  category: "Plastic",
  buy_price: "",
  quantity: "",
  unit: "kg",
  selling_price: "",
};

export default function Admin() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [page, setPage] = useState("dashboard");

  const [products, setProducts] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [orders, setOrders] = useState([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [productForm, setProductForm] = useState(emptyProduct);
  const [editingProduct, setEditingProduct] = useState(null);

  const [purchaseForm, setPurchaseForm] = useState(emptyPurchase);
  const [editingPurchase, setEditingPurchase] = useState(null);

  const [selectedPurchase, setSelectedPurchase] = useState(null);
  const [qrImage, setQrImage] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanMessage, setScanMessage] = useState("");

  // AUTHENTICATION

  useEffect(() => {
    checkSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);

      if (!newSession) {
        setIsAdmin(false);
        setChecking(false);
      } else {
        checkAdmin(newSession);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function checkSession() {
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      setError(error.message);
      setChecking(false);
      return;
    }

    if (data.session) {
      setSession(data.session);
      await checkAdmin(data.session);
    } else {
      setChecking(false);
    }
  }

  async function checkAdmin(currentSession) {
    setChecking(true);
    setError("");

    const { data, error } = await supabase
      .from("admin_users")
      .select("user_id")
      .eq("user_id", currentSession.user.id)
      .maybeSingle();

    if (error) {
      setError(error.message);
      setIsAdmin(false);
    } else {
      setIsAdmin(Boolean(data));
    }

    setChecking(false);
  }

  async function login(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    setSession(data.session);
    await checkAdmin(data.session);
  }

  async function logout() {
    await supabase.auth.signOut();
    setSession(null);
    setIsAdmin(false);
    setPage("dashboard");
    setSelectedPurchase(null);
    setScannerOpen(false);
  }

  // LOAD DATA

  async function loadProducts() {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("id", { ascending: false });

    if (error) throw error;

    setProducts(data || []);
  }

  async function loadPurchases() {
    const { data, error } = await supabase
      .from("purchases")
      .select("*")
      .order("purchase_date", { ascending: false })
      .order("id", { ascending: false });

    if (error) throw error;

    setPurchases(data || []);
  }

  async function loadOrders() {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .order("id", { ascending: false });

    if (error) throw error;

    setOrders(data || []);
  }

  async function loadAll() {
    setLoading(true);
    setError("");

    try {
      await Promise.all([
        loadProducts(),
        loadPurchases(),
        loadOrders(),
      ]);
    } catch (err) {
      setError(err.message || "Could not load data.");
    }

    setLoading(false);
  }

  useEffect(() => {
    if (isAdmin) {
      loadAll();
    }
  }, [isAdmin]);

  // QR CODE GENERATION

  useEffect(() => {
    if (!selectedPurchase?.item_code) return;

    let cancelled = false;

    QRCode.toDataURL(selectedPurchase.item_code, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: "M",
    })
      .then((url) => {
        if (!cancelled) setQrImage(url);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPurchase]);

  // CAMERA SCANNER

  useEffect(() => {
    if (!scannerOpen || !isAdmin) return;

    const scanner = new Html5QrcodeScanner(
      "crs-qr-scanner",
      {
        fps: 10,
        qrbox: { width: 240, height: 180 },
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.EAN_13,
        ],
      },
      false
    );

    let handled = false;

    scanner.render(
      async (decodedText) => {
        if (handled) return;

        handled = true;
        setScanMessage(`Searching item: ${decodedText}`);

        try {
          const { data, error } = await supabase
            .from("purchases")
            .select("*")
            .eq("item_code", decodedText.trim())
            .maybeSingle();

          if (error) throw error;

          if (!data) {
            setScanMessage("No purchase found for this code.");
            handled = false;
            return;
          }

          setSelectedPurchase(data);
          setScannerOpen(false);
          setScanMessage("");
        } catch (err) {
          setScanMessage(err.message || "Could not find this item.");
          handled = false;
        }
      },
      () => {}
    );

    return () => {
      scanner.clear().catch(() => {});
    };
  }, [scannerOpen, isAdmin]);

  // DASHBOARD CALCULATIONS

  const inventoryValue = useMemo(
    () =>
      products.reduce(
        (sum, p) =>
          sum + Number(p.price || 0) * Number(p.stock || 0),
        0
      ),
    [products]
  );

  const purchaseTotals = useMemo(
    () =>
      purchases.reduce(
        (sum, p) => {
          const qty = Number(p.quantity || 0);
          const buy = Number(p.buy_price || 0);
          const sell = Number(p.selling_price || 0);

          sum.cost += buy * qty;
          sum.expectedProfit += (sell - buy) * qty;

          return sum;
        },
        { cost: 0, expectedProfit: 0 }
      ),
    [purchases]
  );

  // PRODUCT FUNCTIONS

  function updateProductField(e) {
    setProductForm({
      ...productForm,
      [e.target.name]: e.target.value,
    });
  }

  async function saveProduct(e) {
    e.preventDefault();
    setError("");
    setMessage("");

    const data = {
      name: productForm.name.trim(),
      description: productForm.description.trim(),
      category: productForm.category,
      price: Number(productForm.price),
      stock: Number(productForm.stock),
      image_url: productForm.image_url.trim(),
      is_published: editingProduct
        ? Boolean(
            products.find((p) => p.id === editingProduct)?.is_published
          )
        : false,
    };

    if (
      !data.name ||
      !Number.isFinite(data.price) ||
      !Number.isFinite(data.stock) ||
      data.price < 0 ||
      data.stock < 0
    ) {
      setError("Please enter valid product information.");
      return;
    }

    setLoading(true);

    const result = editingProduct
      ? await supabase
          .from("products")
          .update(data)
          .eq("id", editingProduct)
      : await supabase.from("products").insert([data]);

    setLoading(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    setMessage(
      editingProduct
        ? "Product updated successfully."
        : "Product added as Draft successfully."
    );

    setProductForm(emptyProduct);
    setEditingProduct(null);

    await loadProducts();
  }

  function startEditProduct(product) {
    setEditingProduct(product.id);

    setProductForm({
      name: product.name || "",
      description: product.description || "",
      category: product.category || "Plastic",
      price: String(product.price ?? ""),
      stock: String(product.stock ?? ""),
      image_url: product.image_url || "",
    });

    setPage("products");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function toggleProductPublished(product) {
    setError("");
    setMessage("");

    const nextPublished = !Boolean(product.is_published);

    const { error } = await supabase
      .from("products")
      .update({ is_published: nextPublished })
      .eq("id", product.id);

    if (error) {
      setError(error.message);
      return;
    }

    setMessage(
      nextPublished
        ? `${product.name} published successfully.`
        : `${product.name} moved to Draft.`
    );

    await loadProducts();
  }

  async function deleteProduct(id) {
    if (!window.confirm("Delete this product?")) return;

    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", id);

    if (error) {
      setError(error.message);
      return;
    }

    setMessage("Product deleted.");
    await loadProducts();
  }

  // PURCHASE FUNCTIONS

  function updatePurchaseField(e) {
    setPurchaseForm({
      ...purchaseForm,
      [e.target.name]: e.target.value,
    });
  }

  async function savePurchase(e) {
    e.preventDefault();
    setError("");
    setMessage("");

    const data = {
      purchase_date: purchaseForm.purchase_date,
      product_name: purchaseForm.product_name.trim(),
      category: purchaseForm.category,
      buy_price: Number(purchaseForm.buy_price),
      quantity: Number(purchaseForm.quantity),
      unit: purchaseForm.unit,
      selling_price: Number(purchaseForm.selling_price),
    };

    if (
      !data.purchase_date ||
      !data.product_name ||
      !Number.isFinite(data.buy_price) ||
      !Number.isFinite(data.quantity) ||
      !Number.isFinite(data.selling_price) ||
      data.buy_price < 0 ||
      data.quantity <= 0 ||
      data.selling_price < 0
    ) {
      setError("Please fill all purchase fields correctly.");
      return;
    }

    setLoading(true);

    const result = editingPurchase
      ? await supabase
          .from("purchases")
          .update(data)
          .eq("id", editingPurchase)
      : await supabase.from("purchases").insert([data]);

    setLoading(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    setMessage(
      editingPurchase
        ? "Purchase updated successfully."
        : "Purchase saved successfully. Stock updated automatically."
    );

    setPurchaseForm(emptyPurchase);
    setEditingPurchase(null);

    await Promise.all([loadPurchases(), loadProducts()]);
  }

  function printPurchaseLabel(item) {
    setSelectedPurchase(item);
  }

  function printCurrentLabel() {
    const label = document.getElementById("crs-print-label");

    if (!label) return;

    const printWindow = window.open("", "_blank", "width=520,height=650");

    if (!printWindow) {
      setError("Please allow pop-ups to print the label.");
      return;
    }

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>CRS Item Label</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              margin: 0;
              padding: 20px;
              text-align: center;
            }
            .crs-item-label {
              width: 320px;
              margin: 0 auto;
              border: 1px solid #ddd;
              padding: 14px;
              box-sizing: border-box;
            }
            .crs-label-brand {
              font-weight: 800;
              font-size: 15px;
              letter-spacing: 1px;
              margin-bottom: 8px;
            }
            .crs-label-name {
              font-size: 16px;
              font-weight: 700;
              margin: 8px 0;
            }
            .crs-label-code {
              font-size: 13px;
              font-weight: 700;
              margin: 8px 0;
            }
            img {
              width: 130px;
              height: 130px;
              object-fit: contain;
            }
            svg {
              max-width: 100%;
              height: auto;
            }
            @media print {
              @page { margin: 5mm; }
              .crs-item-label { border: 0; }
            }
          </style>
        </head>
        <body>
          ${label.outerHTML}
          <script>
            window.onload = () => {
              window.print();
            };
          </script>
        </body>
      </html>
    `);

    printWindow.document.close();
  }

  function downloadPurchaseLabel() {
    const label = document.getElementById("crs-print-label");

    if (!label || !selectedPurchase) return;

    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>${selectedPurchase.item_code} label</title>
          <style>
            body {
              font-family: Arial;
              text-align: center;
              padding: 20px;
            }
            .crs-item-label {
              width: 320px;
              margin: auto;
              border: 1px solid #ddd;
              padding: 14px;
            }
            .crs-label-brand { font-weight: 800; }
            .crs-label-name { font-weight: 700; margin: 8px; }
            .crs-label-code { font-weight: 700; margin: 8px; }
            img { width: 130px; height: 130px; }
            svg { max-width: 100%; height: auto; }
          </style>
        </head>
        <body>
          ${label.outerHTML}
        </body>
      </html>
    `;

    const blob = new Blob([html], {
      type: "text/html;charset=utf-8",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `${selectedPurchase.item_code}-label.html`;
    link.click();

    URL.revokeObjectURL(url);
  }

  function startEditPurchase(item) {
    setEditingPurchase(item.id);

    setPurchaseForm({
      purchase_date: item.purchase_date,
      product_name: item.product_name,
      category: item.category,
      buy_price: String(item.buy_price),
      quantity: String(item.quantity),
      unit: item.unit,
      selling_price: String(item.selling_price),
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deletePurchase(id) {
    if (!window.confirm("Delete this purchase record?")) return;

    const { error } = await supabase
      .from("purchases")
      .delete()
      .eq("id", id);

    if (error) {
      setError(error.message);
      return;
    }

    setMessage("Purchase record deleted.");

    await Promise.all([loadPurchases(), loadProducts()]);
  }

  // LOADING SCREEN

  if (checking) {
    return (
      <div className="admin-loading">
        Checking admin access...
      </div>
    );
  }

  // LOGIN SCREEN

  if (!session) {
    return (
      <div className="admin-login-page">
        <form className="admin-login-card" onSubmit={login}>
          <div className="admin-brand">
            CUMILLA RECYCLE SHOP<span>.</span>
          </div>

          <span className="admin-kicker">ADMINISTRATION</span>

          <h1>Welcome back.</h1>

          <p>Sign in to manage your online store.</p>

          {error && <div className="admin-error">{error}</div>}

          <label>Email Address</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Admin email"
            required
          />

          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Admin password"
            required
          />

          <button className="admin-primary-button" disabled={loading}>
            {loading ? "Signing in..." : "Sign In →"}
          </button>

          <a href="/" className="admin-back-link">
            ← Back to Store
          </a>
        </form>
      </div>
    );
  }

  // ACCESS DENIED

  if (!isAdmin) {
    return (
      <div className="admin-login-page">
        <div className="admin-login-card">
          <h2>Access Denied</h2>
          <p>This account is not registered as an administrator.</p>

          {error && <div className="admin-error">{error}</div>}

          <button className="admin-primary-button" onClick={logout}>
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  // NAVIGATION

  const navigation = [
    { id: "dashboard", label: "Overview", icon: "◫" },
    { id: "products", label: "Products", icon: "▦" },
    { id: "purchases", label: "Purchases", icon: "🛒" },
    { id: "orders", label: "Orders", icon: "▤" },
  ];

  const purchaseCostPreview =
    Number(purchaseForm.buy_price || 0) *
    Number(purchaseForm.quantity || 0);

  const purchaseProfitPreview =
    (Number(purchaseForm.selling_price || 0) -
      Number(purchaseForm.buy_price || 0)) *
    Number(purchaseForm.quantity || 0);

  // MAIN ADMIN PANEL

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          CUMILLA RECYCLE SHOP<span>.</span>
        </div>

        <span className="admin-sidebar-label">MANAGEMENT</span>

        <nav className="admin-navigation">
          {navigation.map((item) => (
            <button
              key={item.id}
              className={page === item.id ? "active" : ""}
              onClick={() => {
                setPage(item.id);
                setError("");
                setMessage("");
              }}
            >
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="admin-sidebar-bottom">
          <small>Signed in as</small>
          <p>{session.user.email}</p>
          <button onClick={logout}>Logout</button>
        </div>
      </aside>

      <main className="admin-main">
        <div className="admin-topline">
          <div>
            <span className="admin-kicker">
              CUMILLA RECYCLE SHOP / ADMIN
            </span>

            <h1>
              {page === "dashboard"
                ? "Overview"
                : page === "products"
                ? "Products"
                : page === "purchases"
                ? "Purchases"
                : "Orders"}
            </h1>
          </div>

          <span className="admin-status">● Admin</span>
        </div>

        {error && <div className="admin-error">{error}</div>}
        {message && <div className="admin-message">{message}</div>}

        {/* DASHBOARD */}

        {page === "dashboard" && (
          <>
            <section className="admin-stat-grid">
              <div className="admin-stat">
                <span>Total Products</span>
                <strong>{products.length}</strong>
                <small>Products in database</small>
              </div>

              <div className="admin-stat">
                <span>Total Orders</span>
                <strong>{orders.length}</strong>
                <small>Recorded orders</small>
              </div>

              <div className="admin-stat">
                <span>Inventory Value</span>
                <strong>{money(inventoryValue)}</strong>
                <small>Based on selling price × stock</small>
              </div>

              <div className="admin-stat">
                <span>Total Purchase Cost</span>
                <strong>{money(purchaseTotals.cost)}</strong>
                <small>Purchase records</small>
              </div>
            </section>

            <section className="admin-section">
              <div className="admin-section-heading">
                <div>
                  <h2>Recent Products</h2>
                  <p>Your latest store inventory</p>
                </div>

                <button
                  className="admin-primary-button"
                  onClick={() => setPage("products")}
                >
                  + Manage Products
                </button>
              </div>

              {products.slice(0, 5).map((product) => (
                <div className="admin-list-row" key={product.id}>
                  <strong>{product.name}</strong>
                  <span>{money(product.price)}</span>
                  <span>Stock: {product.stock}</span>
                  <span>
                    {product.is_published ? "Published" : "Draft"}
                  </span>
                </div>
              ))}
            </section>
          </>
        )}

        {/* PRODUCTS */}

        {page === "products" && (
          <>
            <section className="admin-section">
              <h2>
                {editingProduct ? "Edit Product" : "Add Product"}
              </h2>

              <p>
                New products are saved as Draft. Publish them when ready.
              </p>

              <form
                className="admin-product-form"
                onSubmit={saveProduct}
              >
                <label>Product Name</label>
                <input
                  name="name"
                  value={productForm.name}
                  onChange={updateProductField}
                  required
                />

                <label>Description</label>
                <textarea
                  name="description"
                  value={productForm.description}
                  onChange={updateProductField}
                />

                <label>Category</label>
                <select
                  name="category"
                  value={productForm.category}
                  onChange={updateProductField}
                >
                  <option>Plastic</option>
                  <option>Iron</option>
                  <option>Copper</option>
                  <option>Aluminum</option>
                  <option>Paper</option>
                  <option>Glass</option>
                  <option>Fashion</option>
                  <option>Electronics</option>
                  <option>Accessories</option>
                  <option>Other</option>
                </select>

                <div className="admin-form-row">
                  <div>
                    <label>Selling Price (৳)</label>
                    <input
                      type="number"
                      name="price"
                      min="0"
                      step="0.01"
                      value={productForm.price}
                      onChange={updateProductField}
                      required
                    />
                  </div>

                  <div>
                    <label>Stock</label>
                    <input
                      type="number"
                      name="stock"
                      min="0"
                      step="0.001"
                      value={productForm.stock}
                      onChange={updateProductField}
                      required
                    />
                  </div>
                </div>

                <label>Image URL</label>
                <input
                  name="image_url"
                  value={productForm.image_url}
                  onChange={updateProductField}
                  placeholder="https://..."
                />

                <div className="admin-form-actions">
                  <button
                    className="admin-primary-button"
                    disabled={loading}
                  >
                    {loading
                      ? "Saving..."
                      : editingProduct
                      ? "Update Product"
                      : "Add Product as Draft"}
                  </button>

                  {editingProduct && (
                    <button
                      type="button"
                      className="admin-secondary-button"
                      onClick={() => {
                        setEditingProduct(null);
                        setProductForm(emptyProduct);
                      }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            </section>

            <section className="admin-section">
              <h2>All Products</h2>

              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Category</th>
                      <th>Price</th>
                      <th>Stock</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    {products.map((product) => (
                      <tr key={product.id}>
                        <td>
                          <strong>{product.name}</strong>
                        </td>
                        <td>{product.category}</td>
                        <td>{money(product.price)}</td>
                        <td>{product.stock}</td>
                        <td>
                          <span
                            className={
                              product.is_published
                                ? "admin-message"
                                : "admin-status"
                            }
                          >
                            {product.is_published ? "Published" : "Draft"}
                          </span>
                        </td>

                        <td>
                          <div className="admin-actions">
                            <button
                              onClick={() =>
                                toggleProductPublished(product)
                              }
                            >
                              {product.is_published ? "Unpublish" : "Publish"}
                            </button>

                            <button
                              onClick={() => startEditProduct(product)}
                            >
                              Edit
                            </button>

                            <button
                              className="delete"
                              onClick={() => deleteProduct(product.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {/* PURCHASES */}

        {page === "purchases" && (
          <>
            <section className="admin-stat-grid">
              <div className="admin-stat">
                <span>Purchase Records</span>
                <strong>{purchases.length}</strong>
                <small>Saved purchases</small>
              </div>

              <div className="admin-stat">
                <span>Total Purchase Cost</span>
                <strong>{money(purchaseTotals.cost)}</strong>
                <small>All purchase records</small>
              </div>

              <div className="admin-stat">
                <span>Expected Gross Profit</span>
                <strong>{money(purchaseTotals.expectedProfit)}</strong>
                <small>Before other expenses</small>
              </div>
            </section>

            <section className="admin-section">
              <h2>
                {editingPurchase ? "Edit Purchase" : "Add New Purchase"}
              </h2>

              <p>Record the recycle materials you purchase.</p>

              <form
                className="admin-product-form"
                onSubmit={savePurchase}
              >
                <label>Purchase Date</label>
                <input
                  type="date"
                  name="purchase_date"
                  value={purchaseForm.purchase_date}
                  onChange={updatePurchaseField}
                  required
                />

                <label>Product / Material Name</label>
                <input
                  name="product_name"
                  value={purchaseForm.product_name}
                  onChange={updatePurchaseField}
                  placeholder="Copper, Iron, Plastic..."
                  required
                />

                <label>Category</label>
                <select
                  name="category"
                  value={purchaseForm.category}
                  onChange={updatePurchaseField}
                >
                  <option>Plastic</option>
                  <option>Iron</option>
                  <option>Copper</option>
                  <option>Aluminum</option>
                  <option>Paper</option>
                  <option>Glass</option>
                  <option>Other</option>
                </select>

                <div className="admin-form-row">
                  <div>
                    <label>Buy Price (৳)</label>
                    <input
                      type="number"
                      name="buy_price"
                      min="0"
                      step="0.01"
                      value={purchaseForm.buy_price}
                      onChange={updatePurchaseField}
                      required
                    />
                  </div>

                  <div>
                    <label>Selling Price (৳)</label>
                    <input
                      type="number"
                      name="selling_price"
                      min="0"
                      step="0.01"
                      value={purchaseForm.selling_price}
                      onChange={updatePurchaseField}
                      required
                    />
                  </div>
                </div>

                <div className="admin-form-row">
                  <div>
                    <label>Quantity</label>
                    <input
                      type="number"
                      name="quantity"
                      min="0.001"
                      step="0.001"
                      value={purchaseForm.quantity}
                      onChange={updatePurchaseField}
                      required
                    />
                  </div>

                  <div>
                    <label>Unit</label>
                    <select
                      name="unit"
                      value={purchaseForm.unit}
                      onChange={updatePurchaseField}
                    >
                      <option value="kg">Kilogram (KG)</option>
                      <option value="piece">Piece</option>
                    </select>
                  </div>
                </div>

                <div className="admin-stat-grid">
                  <div className="admin-stat">
                    <span>Total Purchase Cost</span>
                    <strong>{money(purchaseCostPreview)}</strong>
                  </div>

                  <div className="admin-stat">
                    <span>Expected Gross Profit</span>
                    <strong>{money(purchaseProfitPreview)}</strong>
                  </div>
                </div>

                <div className="admin-form-actions">
                  <button
                    className="admin-primary-button"
                    disabled={loading}
                  >
                    {loading
                      ? "Saving..."
                      : editingPurchase
                      ? "Update Purchase"
                      : "Save Purchase"}
                  </button>

                  {editingPurchase && (
                    <button
                      type="button"
                      className="admin-secondary-button"
                      onClick={() => {
                        setEditingPurchase(null);
                        setPurchaseForm(emptyPurchase);
                      }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            </section>

            {/* PURCHASE HISTORY */}

            <section className="admin-section">
              <div className="admin-section-heading">
                <div>
                  <h2>Purchase History</h2>
                  <p>
                    Every purchase has its own QR and barcode label.
                  </p>
                </div>

                <button
                  className="admin-primary-button"
                  onClick={() => {
                    setScanMessage("");
                    setScannerOpen(true);
                  }}
                >
                  Scan QR / Barcode
                </button>
              </div>

              {scanMessage && (
                <div className="admin-message">{scanMessage}</div>
              )}

              {purchases.length === 0 ? (
                <p>No purchase records yet.</p>
              ) : (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Item Code</th>
                        <th>Material</th>
                        <th>Category</th>
                        <th>Buy Price</th>
                        <th>Sell Price</th>
                        <th>Quantity</th>
                        <th>Total Cost</th>
                        <th>Expected Profit</th>
                        <th>Actions</th>
                      </tr>
                    </thead>

                    <tbody>
                      {purchases.map((item) => {
                        const qty = Number(item.quantity);
                        const cost = Number(item.buy_price) * qty;
                        const profit =
                          (Number(item.selling_price) -
                            Number(item.buy_price)) *
                          qty;

                        return (
                          <tr key={item.id}>
                            <td>{item.purchase_date}</td>
                            <td>{item.item_code || "Missing code"}</td>
                            <td>
                              <strong>{item.product_name}</strong>
                            </td>
                            <td>{item.category}</td>
                            <td>{money(item.buy_price)}</td>
                            <td>{money(item.selling_price)}</td>
                            <td>
                              {qty} {item.unit === "kg" ? "KG" : "Piece"}
                            </td>
                            <td>{money(cost)}</td>
                            <td>{money(profit)}</td>

                            <td>
                              <div className="admin-actions">
                                <button
                                  onClick={() => printPurchaseLabel(item)}
                                  disabled={!item.item_code}
                                >
                                  Label
                                </button>

                                <button
                                  onClick={() => startEditPurchase(item)}
                                >
                                  Edit
                                </button>

                                <button
                                  className="delete"
                                  onClick={() => deletePurchase(item.id)}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {/* ORDERS */}

        {page === "orders" && (
          <section className="admin-section">
            <div className="admin-section-heading">
              <div>
                <h2>All Orders</h2>
                <p>Customer order records</p>
              </div>

              <button
                className="admin-secondary-button"
                onClick={loadOrders}
              >
                Refresh
              </button>
            </div>

            {orders.length === 0 ? (
              <p>No recorded orders yet.</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      {Object.keys(orders[0]).map((key) => (
                        <th key={key}>{key.replaceAll("_", " ")}</th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {orders.map((order, index) => (
                      <tr key={order.id || index}>
                        {Object.keys(order).map((key) => (
                          <td key={key}>
                            {typeof order[key] === "object"
                              ? JSON.stringify(order[key])
                              : String(order[key] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {loading && (
          <p className="admin-loading">Loading data...</p>
        )}

        {/* CAMERA SCANNER MODAL */}

        {scannerOpen && (
          <div className="crs-modal-backdrop">
            <div className="crs-modal">
              <div className="admin-section-heading">
                <h2>Scan Item Code</h2>

                <button
                  className="admin-secondary-button"
                  onClick={() => setScannerOpen(false)}
                >
                  Close
                </button>
              </div>

              <p>
                Allow camera access and hold the QR code or barcode
                inside the frame.
              </p>

              <div id="crs-qr-scanner" />

              {scanMessage && <p>{scanMessage}</p>}
            </div>
          </div>
        )}

        {/* ITEM LABEL MODAL */}

        {selectedPurchase && (
          <div className="crs-modal-backdrop">
            <div className="crs-modal">
              <div className="admin-section-heading">
                <h2>Item Label</h2>

                <button
                  className="admin-secondary-button"
                  onClick={() => setSelectedPurchase(null)}
                >
                  Close
                </button>
              </div>

              <div
                id="crs-print-label"
                className="crs-item-label"
              >
                <div className="crs-label-brand">
                  CUMILLA RECYCLE SHOP
                </div>

                <div className="crs-label-name">
                  {selectedPurchase.product_name}
                </div>

                <div className="crs-label-meta">
                  {selectedPurchase.quantity}{" "}
                  {selectedPurchase.unit === "kg" ? "KG" : "Piece"} ·{" "}
                  {selectedPurchase.category}
                </div>

                <div className="crs-label-code">
                  {selectedPurchase.item_code}
                </div>

                {qrImage ? (
                  <img
                    className="crs-label-qr"
                    src={qrImage}
                    alt="Item QR code"
                  />
                ) : (
                  <p>Generating QR...</p>
                )}

                <Barcode
                  value={selectedPurchase.item_code}
                  format="CODE128"
                  width={1.6}
                  height={55}
                  fontSize={12}
                  margin={4}
                />
              </div>

              <div className="admin-form-actions">
                <button
                  className="admin-primary-button"
                  onClick={printCurrentLabel}
                >
                  Print Label
                </button>

                <button
                  className="admin-secondary-button"
                  onClick={downloadPurchaseLabel}
                >
                  Download Label (HTML)
                </button>
              </div>

              <p className="crs-label-note">
                Purchase cost and profit are not included in the QR code.
              </p>

              <p>Buy Price: {money(selectedPurchase.buy_price)}</p>

              <p>
                Expected Selling Price:{" "}
                {money(selectedPurchase.selling_price)}
              </p>

              <p>
                Expected Profit:{" "}
                {money(
                  (Number(selectedPurchase.selling_price) -
                    Number(selectedPurchase.buy_price)) *
                    Number(selectedPurchase.quantity)
                )}
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
