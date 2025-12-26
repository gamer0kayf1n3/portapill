const DB_NAME = 'PortaScheduleDB';
const DB_VERSION = 1; // Incremented version for schema changes

class PortaScheduleDB {
    constructor() {
        this.db = null;
    }

    async init() {
        if (this.db) return this.db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (e) => {
                const db = e.target.result;

                // Devices store - core device information
                if (!db.objectStoreNames.contains('devices')) {
                    const devicesStore = db.createObjectStore('devices', {
                        keyPath: 'device_id',
                        autoIncrement: true
                    });
                    devicesStore.createIndex('device_name', 'device_name', { unique: false });
                    
                }
            };
        });
    }

    async add(storeName, data) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.add(data);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getAll(storeName) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async get(storeName, key) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.get(key);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async update(storeName, data) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.put(data);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async delete(storeName, key) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.delete(key);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getByIndex(storeName, indexName, value) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);
            const index = store.index(indexName);
            const request = index.getAll(value);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async clear(storeName) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async count(storeName) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.count();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // Helper methods for common operations
    async addProduct(name, description, category, sku) {
        const productId = await this.add('products', {
            product_name: name,
            description,
            category,
            sku
        });
        return productId;
    }

    async addInventory(productId, price, stock) {
        return this.add('inventory', {
            product_id: productId,
            price,
            current_stock: stock
        });
    }

    async addToCart(userId, productId, quantity) {
        return this.add('cart', { user_id: userId, product_id: productId, quantity });
    }

    async getCartItems(userId) {
        return this.getByIndex('cart', 'user_id', userId);
    }

    async createOrder(buyerId, sellerId, paymentMethod, amountPaid, amountCharged, amountDiscount, items) {
        const orderId = await this.add('orders', {
            buyer_id: buyerId,
            seller_id: sellerId,
            payment_method: paymentMethod,
            amount_paid: amountPaid,
            amount_charged: amountCharged,
            amount_discount: amountDiscount,
            order_date: new Date().toISOString(),
            status: 'pending'
        });

        // Add order items
        for (const item of items) {
            await this.add('order_items', {
                order_id: orderId,
                product_id: item.product_id,
                quantity: item.quantity,
                price: item.price
            });
        }

        return orderId;
    }

    async getOrdersByBuyer(buyerId) {
        return this.getByIndex('orders', 'buyer_id', buyerId);
    }

    async getOrderItems(orderId) {
        return this.getByIndex('order_items', 'order_id', orderId);
    }

    async addPromo(code, description, discountType, discountValue, validFrom, validTo) {
        return this.add('promo', {
            code,
            description,
            discount_type: discountType,
            discount_value: discountValue,
            valid_from: validFrom,
            valid_to: validTo,
            is_active: true
        });
    }

    async getPromoByCode(code) {
        const promos = await this.getByIndex('promo', 'code', code);
        return promos[0] || null;
    }

    async applyPromoToOrder(orderId, promoId, discountAmount) {
        return this.add('order_promo', { order_id: orderId, promo_id: promoId, discount_amount: discountAmount });
    }
}

// Usage
const db = new PortaScheduleDB();

// Example usage:
/*
(async () => {
    // Add a product with all its info
    const productId = await db.addProduct(
        'Gaming Laptop',
        'High-performance gaming laptop with RTX graphics',
        'Electronics',
        'LAP-001'
    );
    console.log('Product ID:', productId);

    // Add inventory for the product
    await db.addInventory(productId, 1299.99, 50);

    // Add to cart
    await db.addToCart(1, productId, 2);

    // Get cart items
    const cartItems = await db.getCartItems(1);
    console.log('Cart:', cartItems);

    // Create order
    const orderId = await db.createOrder(
        1, // buyer_id
        100, // seller_id
        'credit_card',
        2499.98,
        2599.98,
        100.00,
        [{ product_id: productId, quantity: 2, price: 1299.99 }]
    );

    // Add promo
    const promoId = await db.addPromo(
        'SAVE20',
        '20% off everything',
        'percentage',
        20,
        new Date().toISOString(),
        new Date(Date.now() + 30*24*60*60*1000).toISOString()
    );

    // Apply promo to order
    await db.applyPromoToOrder(orderId, promoId, 100.00);

    // Get orders
    const orders = await db.getOrdersByBuyer(1);
    console.log('Orders:', orders);
})();
*/