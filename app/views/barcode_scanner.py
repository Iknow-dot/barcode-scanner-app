from flask import Blueprint, jsonify, request, abort
from flask_jwt_extended import jwt_required
from app.models import Product  # Absolute import
from app import db  # Absolute import
import requests

bp = Blueprint('barcode_scanner', __name__)

@bp.route('/scan', methods=['POST'])
@jwt_required()
def scan_barcode():
    data = request.get_json()
    barcode = data.get('barcode')
    
    if not barcode:
        abort(400, description="Missing barcode")

    try:
        response = requests.get(f'https://external-service.com/api/products/{barcode}')
        response.raise_for_status()
        product_data = response.json()

        product = Product(
            id=product_data['id'],
            product_name=product_data['product_name'],
            barcode=barcode,
            price=product_data['price'],
            stock=product_data['stock']
        )
        db.session.add(product)
        db.session.commit()

        return jsonify(product_data)
    except requests.RequestException as e:
        abort(500, description=f"External service error: {str(e)}")

    return jsonify({"message": "Product not found"}), 404
