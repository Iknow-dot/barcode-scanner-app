from flask import Blueprint, render_template, request, redirect, url_for, flash, jsonify
from flask_jwt_extended import jwt_required
from app import db
from app.models import UserRole

bp = Blueprint('user_roles', __name__)

@bp.route('/user_roles')
@jwt_required()  # Add JWT authentication to this route
def list_user_roles():
    roles = UserRole.query.all()
    return render_template('user_roles.html', roles=roles)

@bp.route('/user_roles/create', methods=['GET', 'POST'])
@jwt_required()  # Add JWT authentication to this route
def create_user_role():
    if request.method == 'POST':
        role_name = request.form['role_name']
        if role_name:
            new_role = UserRole(role_name=role_name)
            db.session.add(new_role)
            db.session.commit()
            flash('User role created successfully!', 'success')
            return redirect(url_for('user_roles.list_user_roles'))
        else:
            flash('Role name cannot be empty.', 'error')
    
    return render_template('create_user_role.html')

@bp.route('/user_roles/delete/<uuid:id>', methods=['POST'])
@jwt_required()  # Add JWT authentication to this route
def delete_user_role(id):
    role = UserRole.query.get_or_404(id)
    db.session.delete(role)
    db.session.commit()
    flash('User role deleted successfully!', 'success')
    return redirect(url_for('user_roles.list_user_roles'))
