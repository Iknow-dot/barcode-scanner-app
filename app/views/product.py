from flask import Blueprint, jsonify, request, abort
from flask_jwt_extended import jwt_required
from ..models import Product
from .. import db
import uuid
import requests

# Create a blueprint
product_bp = Blueprint('product', __name__)

# -------------------- Product Routes -------------------- #

@product_bp.route('/products', methods=['GET'])
@jwt_required()
def get_products():
    """Retrieve all products."""
    products = Product.query.all()
    return jsonify([{
        "id": str(product.id),
        "product_name": product.product_name,
        "barcode": product.barcode,
        "price": product.price,
        "stock": product.stock
    } for product in products])

@product_bp.route('/products/<uuid:product_id>', methods=['GET'])
@jwt_required()
def get_product(product_id):
    """Retrieve a single product by ID."""
    product = Product.query.get(product_id)
    if product is None:
        abort(404, description="Product not found")
    return jsonify({
        "id": str(product.id),
        "product_name": product.product_name,
        "barcode": product.barcode,
        "price": product.price,
        "stock": product.stock
    })

@product_bp.route('/products', methods=['POST'])
@jwt_required()
def create_product():
    """Create a new product."""
    data = request.get_json()
    if not data.get('barcode') or not data.get('product_name') or not data.get('price') or not data.get('stock'):
        abort(400, description="Missing required fields")

    # Check if the product already exists
    existing_product = Product.query.filter_by(barcode=data['barcode']).first()
    if existing_product:
        abort(400, description="Product with this barcode already exists")

    product = Product(
        id=uuid.uuid4(),
        product_name=data['product_name'],
        barcode=data['barcode'],
        price=data['price'],
        stock=data['stock']
    )
    db.session.add(product)
    db.session.commit()
    return jsonify({"message": "Product created successfully", "id": str(product.id)}), 201

@product_bp.route('/products/<uuid:product_id>', methods=['PUT'])
@jwt_required()
def update_product(product_id):
    """Update an existing product."""
    product = Product.query.get(product_id)
    if product is None:
        abort(404, description="Product not found")

    data = request.get_json()
    product.product_name = data.get('product_name', product.product_name)
    product.price = data.get('price', product.price)
    product.stock = data.get('stock', product.stock)
    
    db.session.commit()
    return jsonify({"message": "Product updated successfully"})

@product_bp.route('/products/<uuid:product_id>', methods=['DELETE'])
@jwt_required()
def delete_product(product_id):
    """Delete a product."""
    product = Product.query.get(product_id)
    if product is None:
        abort(404, description="Product not found")
    
    db.session.delete(product)
    db.session.commit()
    return jsonify({"message": "Product deleted successfully"}), 204

@product_bp.route('/scan', methods=['POST'])
@jwt_required()
def scan_barcode():
    """Handle barcode scanning requests."""
    data = request.get_json()
    barcode = data.get('barcode')

    if not barcode:
        abort(400, description="Missing barcode")

    # Interact with an external web service to get product details
    try:
        response = requests.get(f'https://external-service.com/api/products/{barcode}')
        response.raise_for_status()
        product_data = response.json()

        # Check if product data was returned
        if not product_data:
            return jsonify({"message": "Product not found"}), 404

        # Save or update product in the database
        product = Product.query.filter_by(barcode=barcode).first()
        if product:
            # Update existing product
            product.product_name = product_data.get('product_name', product.product_name)
            product.price = product_data.get('price', product.price)
            product.stock = product_data.get('stock', product.stock)
        else:
            # Create a new product record
            product = Product(
                id=uuid.uuid4(),
                product_name=product_data.get('product_name'),
                barcode=barcode,
                price=product_data.get('price'),
                stock=product_data.get('stock')
            )
            db.session.add(product)

        db.session.commit()
        return jsonify(product_data), 200

    except requests.RequestException as e:
        abort(500, description=f"External service error: {str(e)}")

    except Exception as e:
        abort(500, description=f"Internal error: {str(e)}")

    return jsonify({"message": "Product not found"}), 404
