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
  barcode: "",
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
  const [sales, setSales] = useState([]);

  const [saleCart, setSaleCart] = useState([]);
  const [saleBarcodeInput, setSaleBarcodeInput] = useState("");
  const [saleBarcodeMessage, setSaleBarcodeMessage] = useState("");
  const [saleCameraOpen, setSaleCameraOpen] = useState(false);
  const [saleCustomerName, setSaleCustomerName] = useState("");
  const [salePhone, setSalePhone] = useState("");
  const [salePayment, setSalePayment] = useState("Cash");
  const [savingSale, setSavingSale] = useState(false);
  const [selectedSale, setSelectedSale] = useState(null);
  const [selectedBarcodeProduct, setSelectedBarcodeProduct] = useState(null);

  const [selectedOrder, setSelectedOrder] = useState(null);
  const [updatingOrderId, setUpdatingOrderId] = useState(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [productForm, setProductForm] = useState(emptyProduct);
  const [editingProduct, setEditingProduct] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [removeImage, setRemoveImage] = useState(false);

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
    setSaleCameraOpen(false);
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

  async function loadSales() {
    const { data, error } = await supabase
      .from("sales")
      .select("*")
      .order("id", { ascending: false });

    if (error) throw error;
    setSales(data || []);
  }

  async function loadOrders() {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .order("id", { ascending: false });

    if (error) throw error;
    setOrders(data || []);
  }

  // UPDATE ORDER STATUS

  async function updateOrderStatus(orderId, newStatus) {
    setError("");
    setMessage("");
    setUpdatingOrderId(orderId);

    const { error } = await supabase
      .from("orders")
      .update({ status: newStatus })
      .eq("id", orderId);

    setUpdatingOrderId(null);

    if (error) {
      setError("Could not update order: " + error.message);
      return;
    }

    setMessage(`Order #${orderId} updated to ${newStatus}.`);

    await loadOrders();

    setSelectedOrder((current) =>
      current && current.id === orderId
        ? { ...current, status: newStatus }
        : current
    );
  }

  async function loadAll() {
    setLoading(true);
    setError("");

    try {
      await Promise.all([
        loadProducts(),
        loadPurchases(),
        loadOrders(),
        loadSales(),
      ]);
    } catch (err) {
      setError(err.message || "Could not load data.");
    }

    setLoading(false);
  }

  useEffect(() => {
    if (!isAdmin) return;

    let cancelled = false;

    async function fetchData() {
      if (cancelled) return;
      await loadAll();
    }

    fetchData();

    return () => {
      cancelled = true;
    };
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

  // PURCHASE CAMERA SCANNER

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

  // DIRECT SALE BARCODE CAMERA SCANNER

  useEffect(() => {
    if (!saleCameraOpen || !isAdmin) return;

    const scanner = new Html5QrcodeScanner(
      "crs-sale-barcode-camera",
      {
        fps: 10,
        qrbox: { width: 280, height: 140 },
        formatsToSupport: [
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
        ],
      },
      false
    );

    let handled = false;

    scanner.render(
      (decodedText) => {
        if (handled) return;

        handled = true;
        const code = decodedText.trim();

        const product = products.find(
          (item) => String(item.barcode || "").trim() === code
        );

        if (!product) {
          setSaleBarcodeMessage(
            `Barcode ${code} was not found in Products.`
          );
          handled = false;
          return;
        }

        addProductToSale(product);
        setSaleBarcodeMessage(`${product.name} added to invoice.`);
        setSaleCameraOpen(false);
      },
      () => {}
    );

    return () => {
      scanner.clear().catch(() => {});
    };
  }, [saleCameraOpen, isAdmin, products]);

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

  const totalSalesRevenue = useMemo(
    () => sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0),
    [sales]
  );

  const lowStockProducts = useMemo(
    () => products.filter((product) => Number(product.stock || 0) <= 5),
    [products]
  );

  // PRODUCT IMAGE FUNCTIONS

  function handleImageChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Please select a valid image.");
      e.target.value = "";
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError("Image size must be less than 5 MB.");
      e.target.value = "";
      return;
    }

    setError("");
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setRemoveImage(false);
  }

  function clearSelectedImage() {
    if (imagePreview.startsWith("blob:")) {
      URL.revokeObjectURL(imagePreview);
    }

    setImageFile(null);
    setImagePreview("");
    setRemoveImage(true);
  }

  async function uploadProductImage() {
    if (!imageFile) {
      return removeImage ? "" : productForm.image_url;
    }

    const extension =
      imageFile.name.split(".").pop()?.toLowerCase() || "jpg";

    const filePath = `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.${extension}`;

    const { error } = await supabase.storage
      .from("product-images")
      .upload(filePath, imageFile, {
        cacheControl: "3600",
        upsert: false,
        contentType: imageFile.type,
      });

    if (error) throw error;

    const { data } = supabase.storage
      .from("product-images")
      .getPublicUrl(filePath);

    return data.publicUrl;
  }

  function resetProductForm() {
    if (imagePreview.startsWith("blob:")) {
      URL.revokeObjectURL(imagePreview);
    }

    setProductForm(emptyProduct);
    setEditingProduct(null);
    setImageFile(null);
    setImagePreview("");
    setRemoveImage(false);
  }

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

    const name = productForm.name.trim();
    const price = Number(productForm.price);
    const stock = Number(productForm.stock);

    if (
      !name ||
      !Number.isFinite(price) ||
      !Number.isFinite(stock) ||
      price < 0 ||
      stock < 0
    ) {
      setError("Please enter valid product information.");
      return;
    }

    setLoading(true);

    try {
      const image_url = await uploadProductImage();

      const data = {
        name,
        description: productForm.description.trim(),
        category: productForm.category,
        price,
        stock,
        barcode: productForm.barcode.trim() || null,
        image_url,
        is_published: editingProduct
          ? Boolean(
              products.find((p) => p.id === editingProduct)?.is_published
            )
          : false,
      };

      const result = editingProduct
        ? await supabase
            .from("products")
            .update(data)
            .eq("id", editingProduct)
        : await supabase.from("products").insert([data]);

      if (result.error) throw result.error;

      setMessage(
        editingProduct
          ? "Product updated successfully."
          : "Product added as Draft successfully."
      );

      resetProductForm();
      await loadProducts();
    } catch (err) {
      setError(err.message || "Could not save product.");
    }

    setLoading(false);
  }

  function startEditProduct(product) {
    resetProductForm();

    setEditingProduct(product.id);
    setProductForm({
      name: product.name || "",
      description: product.description || "",
      category: product.category || "Plastic",
      price: String(product.price ?? ""),
      stock: String(product.stock ?? ""),
      barcode: product.barcode || "",
      image_url: product.image_url || "",
    });

    setImagePreview(product.image_url || "");
    setRemoveImage(false);

    setPage("products");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function toggleProductPublished(product) {
    setError("");
    setMessage("");

    const nextPublished = !product.is_published;

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

  function printProductBarcodeLabel(product) {
    if (!product?.barcode) {
      setError(
        "This product does not have a barcode yet. Edit the product and add or generate one first."
      );
      return;
    }

    setSelectedBarcodeProduct(product);
  }

  function printCurrentProductBarcodeLabel() {
    const label = document.getElementById("crs-product-print-label");
    if (!label || !selectedBarcodeProduct) return;

    const printWindow = window.open("", "_blank", "width=520,height=420");

    if (!printWindow) {
      setError("Please allow pop-ups to print the barcode label.");
      return;
    }

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Product Barcode Label</title>
          <style>
            * { box-sizing: border-box; }
            body { font-family: Arial, sans-serif; margin: 0; padding: 8mm; text-align: center; }
            .crs-product-print-label { width: 70mm; margin: 0 auto; padding: 5mm; text-align: center; border: 1px solid #ddd; }
            .crs-product-print-brand { font-size: 11px; font-weight: 800; letter-spacing: 1px; }
            .crs-product-print-name { font-size: 13px; font-weight: 700; margin: 7px 0; }
            .crs-product-print-code { font-size: 10px; margin-top: 4px; }
            svg { max-width: 100%; height: auto; }
            @media print { @page { size: 80mm 50mm; margin: 2mm; } .crs-product-print-label { border: 0; width: 100%; } }
          </style>
        </head>
        <body>
          ${label.outerHTML}
          <script>window.onload = () => window.print();</script>
        </body>
      </html>
    `);

    printWindow.document.close();
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
            window.onload = () => window.print();
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

  // DIRECT SALE / POS FUNCTIONS

  function handleSaleBarcodeSubmit(e) {
    e.preventDefault();

    const code = saleBarcodeInput.trim();
    if (!code) return;

    const product = products.find(
      (item) => String(item.barcode || "").trim() === code
    );

    if (!product) {
      setSaleBarcodeMessage(
        `Barcode ${code} was not found. Check the product barcode.`
      );
      setSaleBarcodeInput("");
      return;
    }

    addProductToSale(product);
    setSaleBarcodeMessage(`${product.name} added to invoice.`);
    setSaleBarcodeInput("");
  }

  function generateProductBarcode() {
    const code = `CRS${Date.now()}`;
    setProductForm((current) => ({
      ...current,
      barcode: code,
    }));
  }


  const saleSubtotal = saleCart.reduce(
    (sum, item) =>
      sum + Number(item.price || 0) * Number(item.quantity || 0),
    0
  );

  function addProductToSale(product) {
    if (Number(product.stock) <= 0) {
      setError(`${product.name} is out of stock.`);
      return;
    }

    setError("");
    setMessage("");

    setSaleCart((current) => {
      const existing = current.find(
        (item) => item.product_id === product.id
      );

      if (existing) {
        if (Number(existing.quantity) + 1 > Number(product.stock)) {
          setError(`Not enough stock for ${product.name}.`);
          return current;
        }

        return current.map((item) =>
          item.product_id === product.id
            ? { ...item, quantity: Number(item.quantity) + 1 }
            : item
        );
      }

      return [
        ...current,
        {
          product_id: product.id,
          name: product.name,
          price: Number(product.price),
          quantity: 1,
          stock: Number(product.stock),
        },
      ];
    });
  }

  function updateSaleQuantity(productId, value) {
    const quantity = Number(value);

    if (!Number.isFinite(quantity) || quantity <= 0) return;

    setSaleCart((current) =>
      current.map((item) => {
        if (item.product_id !== productId) return item;

        if (quantity > item.stock) {
          setError(`Available stock: ${item.stock}`);
          return item;
        }

        setError("");

        return {
          ...item,
          quantity,
        };
      })
    );
  }

  function removeSaleItem(productId) {
    setSaleCart((current) =>
      current.filter((item) => item.product_id !== productId)
    );
  }

  function resetSaleForm() {
    setSaleCart([]);
    setSaleBarcodeInput("");
    setSaleBarcodeMessage("");
    setSaleCustomerName("");
    setSalePhone("");
    setSalePayment("Cash");
  }

  async function createDirectSale(e) {
    e.preventDefault();

    if (saleCart.length === 0) {
      setError("Please add at least one product.");
      return;
    }

    for (const item of saleCart) {
      const product = products.find(
        (p) => p.id === item.product_id
      );

      if (!product || Number(item.quantity) > Number(product.stock)) {
        setError(`Insufficient stock for ${item.name}. Please refresh.`);
        return;
      }
    }

    setError("");
    setMessage("");
    setSavingSale(true);

    try {
      const { data, error } = await supabase.rpc(
        "create_direct_sale",
        {
          p_customer_name: saleCustomerName.trim() || "Walk-in Customer",
          p_phone: salePhone.trim() || null,
          p_payment_method: salePayment,
          p_items: saleCart.map((item) => ({
            product_id: item.product_id,
            quantity: Number(item.quantity),
          })),
        }
      );

      if (error) throw error;

      const savedSale = {
        ...data,
        customer_name: saleCustomerName.trim() || "Walk-in Customer",
        phone: salePhone.trim() || "",
        payment_method: salePayment,
        created_at: new Date().toISOString(),
      };

      setSelectedSale(savedSale);
      setMessage(
        `Invoice ${data.invoice_number} created successfully!`
      );

      resetSaleForm();

      await Promise.all([loadProducts(), loadSales()]);
    } catch (err) {
      setError(err.message || "Could not create invoice.");
    } finally {
      setSavingSale(false);
    }
  }

  // INVOICE PRINT

  function printSaleInvoice(sale) {
    if (!sale) return;

    const items = Array.isArray(sale.items) ? sale.items : [];

    const rows = items
      .map(
        (item, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeInvoiceText(item.name || "Product")}</td>
            <td>${money(item.price)}</td>
            <td>${Number(item.quantity || 0)}</td>
            <td>${money(item.line_total)}</td>
          </tr>
        `
      )
      .join("");

    const invoiceWindow = window.open(
      "",
      "_blank",
      "width=900,height=750"
    );

    if (!invoiceWindow) {
      setError("Please allow pop-ups to print the invoice.");
      return;
    }

    invoiceWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>${escapeInvoiceText(sale.invoice_number)}</title>
        <style>
          * {
            box-sizing: border-box;
          }

          body {
            font-family: Arial, sans-serif;
            color: #222;
            margin: 0;
            padding: 35px;
            background: #fff;
          }

          .invoice {
            max-width: 850px;
            margin: auto;
            border: 1px solid #ddd;
            padding: 35px;
          }

          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 3px solid #172b4d;
            padding-bottom: 22px;
          }

          .brand {
            font-size: 23px;
            font-weight: 800;
            color: #172b4d;
            letter-spacing: 1px;
          }

          .brand small {
            display: block;
            font-size: 11px;
            color: #777;
            margin-top: 7px;
            letter-spacing: 2px;
          }

          .invoice-title {
            font-size: 32px;
            font-weight: 800;
            color: #172b4d;
            text-align: right;
          }

          .invoice-number {
            text-align: right;
            margin-top: 8px;
            font-size: 13px;
          }

          .info {
            display: flex;
            justify-content: space-between;
            gap: 25px;
            margin: 30px 0;
          }

          .info h3 {
            font-size: 13px;
            color: #172b4d;
            text-transform: uppercase;
            margin-bottom: 10px;
          }

          .info p {
            font-size: 13px;
            margin: 7px 0;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
          }

          th {
            background: #172b4d;
            color: white;
            padding: 13px 10px;
            font-size: 12px;
            text-align: left;
          }

          td {
            border-bottom: 1px solid #ddd;
            padding: 13px 10px;
            font-size: 13px;
          }

          .totals {
            width: 300px;
            margin: 25px 0 0 auto;
          }

          .total-row {
            display: flex;
            justify-content: space-between;
            padding: 9px 0;
            font-size: 14px;
          }

          .grand-total {
            border-top: 2px solid #172b4d;
            margin-top: 8px;
            padding-top: 15px;
            font-size: 19px;
            font-weight: 800;
            color: #172b4d;
          }

          .footer {
            text-align: center;
            border-top: 1px solid #ddd;
            margin-top: 50px;
            padding-top: 20px;
            font-size: 12px;
            color: #777;
          }

          .signature {
            display: flex;
            justify-content: flex-end;
            margin-top: 55px;
          }

          .signature div {
            width: 190px;
            text-align: center;
            border-top: 1px solid #444;
            padding-top: 8px;
            font-size: 12px;
          }

          @media print {
            body {
              padding: 0;
            }

            .invoice {
              border: none;
              padding: 15px;
            }

            @page {
              size: A4;
              margin: 12mm;
            }
          }
        </style>
      </head>

      <body>
        <div class="invoice">

          <div class="header">
            <div class="brand">
              CUMILLA RECYCLE SHOP
              <small>QUALITY RECYCLE PRODUCTS</small>
            </div>

            <div>
              <div class="invoice-title">INVOICE</div>
              <div class="invoice-number">
                <strong>Invoice:</strong>
                ${escapeInvoiceText(sale.invoice_number)}
              </div>
              <div class="invoice-number">
                <strong>Date:</strong>
                ${new Date(sale.created_at || Date.now()).toLocaleDateString("en-BD")}
              </div>
            </div>
          </div>

          <div class="info">
            <div>
              <h3>Bill To</h3>
              <p><strong>${escapeInvoiceText(sale.customer_name || "Walk-in Customer")}</strong></p>
              <p>Phone: ${escapeInvoiceText(sale.phone || "N/A")}</p>
            </div>

            <div>
              <h3>Payment Information</h3>
              <p>Payment Method: ${escapeInvoiceText(sale.payment_method || "Cash")}</p>
              <p>Status: Paid</p>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>SL</th>
                <th>Product Description</th>
                <th>Unit Price</th>
                <th>Quantity</th>
                <th>Total</th>
              </tr>
            </thead>

            <tbody>
              ${rows}
            </tbody>
          </table>

          <div class="totals">
            <div class="total-row">
              <span>Subtotal</span>
              <strong>${money(sale.subtotal)}</strong>
            </div>

            <div class="total-row grand-total">
              <span>Grand Total</span>
              <strong>${money(sale.total)}</strong>
            </div>
          </div>

          <div class="signature">
            <div>Authorized Signature</div>
          </div>

          <div class="footer">
            <strong>Thank you for your business!</strong>
            <p>CUMILLA RECYCLE SHOP</p>
          </div>

        </div>

        <script>
          window.onload = () => window.print();
        </script>
      </body>
      </html>
    `);

    invoiceWindow.document.close();
  }

  function escapeInvoiceText(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char]);
  }

  function printSaleHistoryInvoice(sale) {
    printSaleInvoice(sale);
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
    { id: "direct-sale", label: "Direct Sale", icon: "🧾" },
    { id: "sales-history", label: "Sales History", icon: "📊" },
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
                : page === "orders"
                ? "Orders"
                : page === "direct-sale"
                ? "Direct Sale"
                : "Sales History"}
            </h1>
          </div>

          <span className="admin-status">● Admin</span>
        </div>

        {error && <div className="admin-error">{error}</div>}
        {message && <div className="admin-message">{message}</div>}
                {/* DASHBOARD */}

        {page === "dashboard" && (
          <>
            <section
              style={{
                background: "linear-gradient(135deg, #142b45 0%, #244d70 100%)",
                color: "#fff",
                borderRadius: "18px",
                padding: "26px",
                marginBottom: "22px",
                boxShadow: "0 12px 30px rgba(20,43,69,.14)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", flexWrap: "wrap", alignItems: "center" }}>
                <div>
                  <span style={{ fontSize: "11px", letterSpacing: "2px", opacity: .75 }}>BUSINESS OVERVIEW</span>
                  <h2 style={{ color: "#fff", margin: "8px 0", fontSize: "26px" }}>Welcome to your control center</h2>
                  <p style={{ color: "rgba(255,255,255,.75)", margin: 0 }}>Monitor inventory, orders and counter sales in one place.</p>
                </div>
                <button className="admin-primary-button" onClick={() => setPage("direct-sale")} style={{ background: "#fff", color: "#17324f" }}>
                  + New Direct Sale
                </button>
              </div>
            </section>

            <section className="admin-stat-grid">
              <div className="admin-stat"><span>Products</span><strong>{products.length}</strong><small>All inventory items</small></div>
              <div className="admin-stat"><span>Online Orders</span><strong>{orders.length}</strong><small>Orders received</small></div>
              <div className="admin-stat"><span>Direct Invoices</span><strong>{sales.length}</strong><small>Counter transactions</small></div>
              <div className="admin-stat"><span>Sales Revenue</span><strong>{money(totalSalesRevenue)}</strong><small>Direct sale invoices</small></div>
              <div className="admin-stat"><span>Inventory Value</span><strong>{money(inventoryValue)}</strong><small>Selling price × current stock</small></div>
              <div className="admin-stat"><span>Purchase Cost</span><strong>{money(purchaseTotals.cost)}</strong><small>Recorded purchase value</small></div>
            </section>

            <section className="admin-section">
              <div className="admin-section-heading">
                <div><h2>Inventory Health</h2><p>Quick view of products that may need attention</p></div>
                <button className="admin-secondary-button" onClick={() => setPage("products")}>Manage Products</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "14px" }}>
                <div style={{ padding: "18px", borderRadius: "12px", background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
                  <span style={{ color: "#166534", fontSize: "13px" }}>Published Products</span>
                  <h2 style={{ color: "#166534", margin: "8px 0 0" }}>{products.filter((p) => p.is_published).length}</h2>
                </div>
                <div style={{ padding: "18px", borderRadius: "12px", background: "#fff7ed", border: "1px solid #fed7aa" }}>
                  <span style={{ color: "#9a3412", fontSize: "13px" }}>Low Stock (5 or less)</span>
                  <h2 style={{ color: "#9a3412", margin: "8px 0 0" }}>{lowStockProducts.length}</h2>
                </div>
                <div style={{ padding: "18px", borderRadius: "12px", background: "#eff6ff", border: "1px solid #bfdbfe" }}>
                  <span style={{ color: "#1d4ed8", fontSize: "13px" }}>Draft Products</span>
                  <h2 style={{ color: "#1d4ed8", margin: "8px 0 0" }}>{products.filter((p) => !p.is_published).length}</h2>
                </div>
              </div>
              {lowStockProducts.length > 0 ? (
                <div style={{ marginTop: "20px" }}>
                  <h3>Products needing restock</h3>
                  {lowStockProducts.slice(0, 6).map((product) => (
                    <div className="admin-list-row" key={product.id}>
                      <strong>{product.name}</strong><span>{money(product.price)}</span>
                      <span style={{ color: Number(product.stock) === 0 ? "#dc2626" : "#b45309", fontWeight: 700 }}>
                        {Number(product.stock) === 0 ? "Out of stock" : `Only ${product.stock} left`}
                      </span>
                    </div>
                  ))}
                </div>
              ) : <p style={{ marginTop: "18px", color: "#15803d" }}>All products currently have more than 5 units in stock.</p>}
            </section>

            <section className="admin-section">
              <div className="admin-section-heading">
                <div><h2>Recent Products</h2><p>Your latest store inventory</p></div>
                <button className="admin-secondary-button" onClick={() => setPage("products")}>View All Products</button>
              </div>
              {products.slice(0, 5).map((product) => (
                <div className="admin-list-row" key={product.id}>
                  <strong>{product.name}</strong>
                  <span>{money(product.price)}</span>
                  <span>Stock: {product.stock}</span>
                  <span>{product.is_published ? "Published" : "Draft"}</span>
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

                <label>Product Barcode</label>
                <div className="admin-form-row">
                  <div>
                    <input
                      name="barcode"
                      type="text"
                      value={productForm.barcode}
                      onChange={updateProductField}
                      placeholder="Scan or enter barcode"
                    />
                  </div>

                  <div>
                    <button
                      type="button"
                      className="admin-secondary-button"
                      onClick={generateProductBarcode}
                    >
                      Generate Barcode
                    </button>
                  </div>
                </div>

                {productForm.barcode && (
                  <div style={{ padding: "10px 0", overflowX: "auto" }}>
                    <Barcode
                      value={productForm.barcode}
                      format="CODE128"
                      height={55}
                    />
                  </div>
                )}

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

                <div className="crs-image-upload">
                  <label>Product Image</label>

                  <p>
                    Choose an image from your device or take a photo.
                    Maximum size: 5 MB.
                  </p>

                  <div className="crs-image-buttons">
                    <label className="admin-secondary-button crs-file-button">
                      📁 Choose from Gallery
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleImageChange}
                        hidden
                      />
                    </label>

                    <label className="admin-secondary-button crs-file-button">
                      📷 Take Photo
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={handleImageChange}
                        hidden
                      />
                    </label>
                  </div>

                  {imagePreview && (
                    <div className="crs-image-preview">
                      <img src={imagePreview} alt="Product preview" />

                      <button
                        type="button"
                        className="admin-secondary-button"
                        onClick={clearSelectedImage}
                      >
                        Remove Image
                      </button>
                    </div>
                  )}

                  {!imagePreview && (
                    <div className="crs-image-empty">
                      No image selected
                    </div>
                  )}
                </div>

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
                      onClick={resetProductForm}
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
                      <th>Barcode</th>
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
                          <div className="crs-product-table-cell">
                            {product.image_url && (
                              <img
                                src={product.image_url}
                                alt={product.name}
                              />
                            )}
                            <strong>{product.name}</strong>
                          </div>
                        </td>

                        <td>
                          {product.barcode ? (
                            <div style={{ minWidth: "150px" }}>
                              <small>{product.barcode}</small>
                              <Barcode
                                value={product.barcode}
                                format="CODE128"
                                height={35}
                                width={1.2}
                                fontSize={9}
                              />
                            </div>
                          ) : (
                            "Not set"
                          )}
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
                              type="button"
                              disabled={!product.barcode}
                              onClick={() => printProductBarcodeLabel(product)}
                            >
                              Print Barcode
                            </button>

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
                        setPurchaseForm(emptyPurchase);
                        setEditingPurchase(null);
                      }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            </section>

            <section className="admin-section">
              <div className="admin-section-heading">
                <div>
                  <h2>Purchase History</h2>
                  <p>All recorded material purchases</p>
                </div>
              </div>

              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Material</th>
                      <th>Category</th>
                      <th>Buy Price</th>
                      <th>Quantity</th>
                      <th>Purchase Total</th>
                      <th>Expected Profit</th>
                      <th>Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    {purchases.map((item) => (
                      <tr key={item.id}>
                        <td>{item.purchase_date}</td>
                        <td>{item.product_name}</td>
                        <td>{item.category}</td>
                        <td>{money(item.buy_price)}</td>
                        <td>{item.quantity} {item.unit}</td>
                        <td>
                          {money(Number(item.buy_price) * Number(item.quantity))}
                        </td>
                        <td>
                          {money(
                            (Number(item.selling_price) - Number(item.buy_price)) *
                              Number(item.quantity)
                          )}
                        </td>
                        <td>
                          <div className="admin-actions">
                            <button
                              type="button"
                              onClick={() => printPurchaseLabel(item)}
                            >
                              Label
                            </button>
                            <button
                              type="button"
                              onClick={() => startEditPurchase(item)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="delete"
                              onClick={() => deletePurchase(item.id)}
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

        {/* ORDERS */}

        {page === "orders" && (
          <section className="admin-section">
            <div className="admin-section-heading">
              <div>
                <h2>Online Orders</h2>
                <p>Manage customer orders from your website</p>
              </div>
            </div>

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Customer</th>
                    <th>Phone</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th>Order Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <td>#{order.id}</td>
                      <td>{order.customer_name}</td>
                      <td>{order.phone}</td>
                      <td>{money(order.total)}</td>

                      <td>
                        <select
                          value={order.status || "Pending"}
                          disabled={updatingOrderId === order.id}
                          onChange={(e) =>
                            updateOrderStatus(order.id, e.target.value)
                          }
                        >
                          <option value="Pending">Pending</option>
                          <option value="Confirmed">Confirmed</option>
                          <option value="Processing">Processing</option>
                          <option value="Shipped">Shipped</option>
                          <option value="Delivered">Delivered</option>
                        </select>
                      </td>

                      <td>
                        {order.created_at
                          ? new Date(order.created_at).toLocaleString("en-BD")
                          : "N/A"}
                      </td>

                      <td>
                        <button
                          className="admin-primary-button"
                          onClick={() => setSelectedOrder(order)}
                        >
                          View Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
                {/* DIRECT SALE / POS */}

        {page === "direct-sale" && (
          <section className="admin-section">
            <div className="admin-section-heading">
              <div>
                <h2>Create New Invoice</h2>
                <p>Scan product barcode to add items to invoice</p>
              </div>
            </div>

            <form onSubmit={createDirectSale}>
              <div className="admin-form-row">
                <div>
                  <label>Customer Name (Optional)</label>
                  <input
                    value={saleCustomerName}
                    onChange={(e) => setSaleCustomerName(e.target.value)}
                    placeholder="Walk-in Customer"
                  />
                </div>

                <div>
                  <label>Phone Number (Optional)</label>
                  <input
                    value={salePhone}
                    onChange={(e) => setSalePhone(e.target.value)}
                    placeholder="01XXXXXXXXX"
                  />
                </div>
              </div>

              <label>Payment Method</label>
              <select
                value={salePayment}
                onChange={(e) => setSalePayment(e.target.value)}
              >
                <option value="Cash">Cash</option>
                <option value="bKash">bKash</option>
                <option value="Nagad">Nagad</option>
                <option value="Bank">Bank</option>
              </select>

              <hr />

              <h3>Scan Product Barcode</h3>

              <label>USB Barcode Scanner</label>
              <input
                autoFocus
                type="text"
                value={saleBarcodeInput}
                onChange={(e) => setSaleBarcodeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSaleBarcodeSubmit(e);
                  }
                }}
                placeholder="Click here and scan product barcode"
              />

              {saleBarcodeMessage && (
                <p>{saleBarcodeMessage}</p>
              )}

              <button
                type="button"
                className="admin-secondary-button"
                onClick={() => {
                  setSaleBarcodeMessage("");
                  setSaleCameraOpen(true);
                }}
                style={{ marginTop: "10px" }}
              >
                📷 Open Camera Scanner
              </button>

              <hr />

              <h3>Invoice Items</h3>

              {saleCart.length === 0 ? (
                <p>No products scanned yet.</p>
              ) : (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Fixed Price</th>
                        <th>Quantity</th>
                        <th>Total</th>
                        <th>Action</th>
                      </tr>
                    </thead>

                    <tbody>
                      {saleCart.map((item) => (
                        <tr key={item.product_id}>
                          <td>{item.name}</td>
                          <td>{money(item.price)}</td>
                          <td>
                            <input
                              type="number"
                              min="0.001"
                              step="0.001"
                              max={item.stock}
                              value={item.quantity}
                              onChange={(e) =>
                                updateSaleQuantity(
                                  item.product_id,
                                  e.target.value
                                )
                              }
                              style={{ width: "90px" }}
                            />
                            <small> Max: {item.stock}</small>
                          </td>
                          <td>
                            {money(item.price * item.quantity)}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="admin-secondary-button"
                              onClick={() =>
                                removeSaleItem(item.product_id)
                              }
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="admin-stat-grid">
                <div className="admin-stat">
                  <span>Total Products</span>
                  <strong>{saleCart.length}</strong>
                </div>

                <div className="admin-stat">
                  <span>Grand Total</span>
                  <strong>{money(saleSubtotal)}</strong>
                </div>
              </div>

              <div className="admin-form-actions">
                <button
                  type="submit"
                  className="admin-primary-button"
                  disabled={savingSale || saleCart.length === 0}
                >
                  {savingSale ? "Creating Invoice..." : "Create Invoice"}
                </button>

                <button
                  type="button"
                  className="admin-secondary-button"
                  onClick={resetSaleForm}
                >
                  Clear Invoice
                </button>
              </div>
            </form>
          </section>
        )}

        {/* SALES HISTORY */}

        {page === "sales-history" && (
          <section className="admin-section">
            <div className="admin-section-heading">
              <div>
                <h2>Direct Sales History</h2>
                <p>All counter sales and invoices</p>
              </div>

              <button
                type="button"
                className="admin-secondary-button"
                onClick={loadSales}
              >
                Refresh
              </button>
            </div>

            <div className="admin-stat-grid">
              <div className="admin-stat">
                <span>Total Invoices</span>
                <strong>{sales.length}</strong>
              </div>

              <div className="admin-stat">
                <span>Total Direct Sale Revenue</span>
                <strong>{money(totalSalesRevenue)}</strong>
              </div>
            </div>

            {sales.length === 0 ? (
              <p>No direct sales yet.</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Invoice No.</th>
                      <th>Customer</th>
                      <th>Phone</th>
                      <th>Payment</th>
                      <th>Total</th>
                      <th>Date</th>
                      <th>Action</th>
                    </tr>
                  </thead>

                  <tbody>
                    {sales.map((sale) => (
                      <tr key={sale.id}>
                        <td>{sale.invoice_number}</td>
                        <td>{sale.customer_name}</td>
                        <td>{sale.phone || "N/A"}</td>
                        <td>{sale.payment_method}</td>
                        <td>{money(sale.total)}</td>
                        <td>
                          {sale.created_at
                            ? new Date(sale.created_at).toLocaleDateString("en-BD")
                            : "N/A"}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="admin-primary-button"
                            onClick={() => printSaleHistoryInvoice(sale)}
                          >
                            Print Invoice
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* ORDER DETAILS MODAL */}

        {selectedOrder && (
          <div
            className="crs-modal-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setSelectedOrder(null);
              }
            }}
          >
            <div className="crs-modal">
              <div className="admin-section-heading">
                <div>
                  <h2>Order #{selectedOrder.id}</h2>
                  <p>Complete customer order information</p>
                </div>

                <button
                  type="button"
                  className="admin-secondary-button"
                  onClick={() => setSelectedOrder(null)}
                >
                  Close
                </button>
              </div>

              <h3>Customer Information</h3>
              <p><strong>Name:</strong> {selectedOrder.customer_name}</p>
              <p><strong>Phone:</strong> {selectedOrder.phone}</p>
              <p><strong>Email:</strong> {selectedOrder.email || "Not provided"}</p>
              <p><strong>District:</strong> {selectedOrder.district}</p>
              <p><strong>Address:</strong> {selectedOrder.address}</p>
              <p><strong>Payment:</strong> {selectedOrder.payment_method}</p>

              <hr />

              <h3>Ordered Products</h3>

              {Array.isArray(selectedOrder.items) &&
              selectedOrder.items.length > 0 ? (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Price</th>
                        <th>Quantity</th>
                        <th>Total</th>
                      </tr>
                    </thead>

                    <tbody>
                      {selectedOrder.items.map((item, index) => (
                        <tr key={item.product_id || index}>
                          <td>{item.name || "Product"}</td>
                          <td>{money(item.price)}</td>
                          <td>{item.quantity}</td>
                          <td>
                            {money(
                              item.line_total ??
                                Number(item.price || 0) *
                                  Number(item.quantity || 0)
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>No product details available.</p>
              )}

              <hr />

              <p><strong>Subtotal:</strong> {money(selectedOrder.subtotal)}</p>
              <p><strong>Delivery:</strong> {money(selectedOrder.delivery_charge)}</p>
              <h3>Grand Total: {money(selectedOrder.total)}</h3>

              <p><strong>Current Status:</strong> {selectedOrder.status}</p>

              <label>Update Order Status</label>
              <select
                value={selectedOrder.status || "Pending"}
                disabled={updatingOrderId === selectedOrder.id}
                onChange={(e) =>
                  updateOrderStatus(selectedOrder.id, e.target.value)
                }
              >
                <option value="Pending">Pending</option>
                <option value="Confirmed">Confirmed</option>
                <option value="Processing">Processing</option>
                <option value="Shipped">Shipped</option>
                <option value="Delivered">Delivered</option>
              </select>
            </div>
          </div>
        )}

        {/* SUCCESSFUL INVOICE MODAL */}

        {selectedSale && (
          <div className="crs-modal-backdrop">
            <div className="crs-modal">
              <div className="admin-section-heading">
                <div>
                  <h2>Invoice Created!</h2>
                  <p>{selectedSale.invoice_number}</p>
                </div>

                <button
                  type="button"
                  className="admin-secondary-button"
                  onClick={() => setSelectedSale(null)}
                >
                  Close
                </button>
              </div>

              <h3>CUMILLA RECYCLE SHOP</h3>
              <h2>{money(selectedSale.total)}</h2>
              <p>Customer: {selectedSale.customer_name}</p>
              <p>Payment: {selectedSale.payment_method}</p>

              <button
                type="button"
                className="admin-primary-button"
                onClick={() => printSaleInvoice(selectedSale)}
              >
                🖨 Print / Save PDF
              </button>
            </div>
          </div>
        )}

        {/* DIRECT SALE BARCODE CAMERA MODAL */}

        {saleCameraOpen && (
          <div className="crs-modal-backdrop">
            <div className="crs-modal">
              <div className="admin-section-heading">
                <h2>Scan Product Barcode</h2>

                <button
                  type="button"
                  className="admin-secondary-button"
                  onClick={() => setSaleCameraOpen(false)}
                >
                  Close
                </button>
              </div>

              <p>
                Allow camera access and hold the product barcode inside the frame.
              </p>

              <div id="crs-sale-barcode-camera" />

              {saleBarcodeMessage && <p>{saleBarcodeMessage}</p>}
            </div>
          </div>
        )}

        {/* PURCHASE CAMERA SCANNER MODAL */}

        {scannerOpen && (
          <div className="crs-modal-backdrop">
            <div className="crs-modal">
              <div className="admin-section-heading">
                <h2>Scan Item Code</h2>

                <button
                  type="button"
                  className="admin-secondary-button"
                  onClick={() => setScannerOpen(false)}
                >
                  Close
                </button>
              </div>

              <p>
                Allow camera access and hold the QR code or barcode inside the frame.
              </p>

              <div id="crs-qr-scanner" />

              {scanMessage && <p>{scanMessage}</p>}
            </div>
          </div>
        )}

        {/* PURCHASE LABEL MODAL */}

        {selectedPurchase && (
          <div className="crs-modal-backdrop">
            <div className="crs-modal">
              <div className="admin-section-heading">
                <h2>Purchase Item Label</h2>

                <button
                  type="button"
                  className="admin-secondary-button"
                  onClick={() => setSelectedPurchase(null)}
                >
                  Close
                </button>
              </div>

              <div id="crs-print-label" className="crs-item-label">
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
                  type="button"
                  className="admin-primary-button"
                  onClick={printCurrentLabel}
                >
                  Print Label
                </button>

                <button
                  type="button"
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
              <p>Expected Selling Price: {money(selectedPurchase.selling_price)}</p>
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

        {/* PRODUCT BARCODE LABEL MODAL */}

        {selectedBarcodeProduct && (
          <div className="crs-modal-backdrop">
            <div className="crs-modal">
              <div className="admin-section-heading">
                <h2>Product Barcode Label</h2>

                <button
                  type="button"
                  className="admin-secondary-button"
                  onClick={() => setSelectedBarcodeProduct(null)}
                >
                  Close
                </button>
              </div>

              <div
                id="crs-product-print-label"
                className="crs-product-print-label"
              >
                <div className="crs-product-print-brand">
                  CUMILLA RECYCLE SHOP
                </div>

                <div className="crs-product-print-name">
                  {selectedBarcodeProduct.name}
                </div>

                <p>{money(selectedBarcodeProduct.price)}</p>

                <Barcode
                  value={selectedBarcodeProduct.barcode}
                  format="CODE128"
                  width={1.8}
                  height={55}
                  fontSize={12}
                  margin={4}
                />

                <div className="crs-product-print-code">
                  {selectedBarcodeProduct.barcode}
                </div>
              </div>

              <div className="admin-form-actions">
                <button
                  type="button"
                  className="admin-primary-button"
                  onClick={printCurrentProductBarcodeLabel}
                >
                  Print Product Label
                </button>
              </div>
            </div>
          </div>
        )}

        {loading && (
          <p className="admin-loading">Loading data...</p>
        )}
      </main>
    </div>
  );
}