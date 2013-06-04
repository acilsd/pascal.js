/*
 * Based on https://raw.github.com/zaach/floop.js/master/lib/lljsgen.js @ 4a981a2799
 */

var util = require('util');

function id(identifier) {
  return identifier.split('-').join('_').replace('?', '$');
}

function SymbolTable() {
  var data = [{}];

  function begin_scope() {
    data.push({});
  }
  function end_scope() {
    if (data.length === 1) {
      throw new Error("end_scope without begin_scope");
    }
    data.pop();
  }

  function indexOf(name) {
    for(var idx = data.length-1; idx >= 0; idx--) {
      if (data[idx][name]) {
        return idx;
      }
    }
    return undefined;
  }

  function lookup(name) {
    var name = name.toUpperCase(),
        idx = indexOf(name);
    if (typeof(idx) !== "undefined") {
      return data[idx][name];
    }
    return undefined;
  }

  function insert(name, value) {
    data[data.length-1][name.toUpperCase()] = value;
  }

  function replace(name, value) {
    var name = name.toUppertCase(),
        idx = indexOf(name);
    if (typeof(idx) !== "undefined") {
      data[idx][name] = value;
    } else {
      throw new Error("Name '" + name + "' not found to replace");
    }
  }

  function display() {
    console.warn("-------------");
    for(var idx = 0; idx < data.length; idx++) {
      console.warn("--- " + idx + " ---");
      for(var name in data[idx]) {
        console.warn(name + ": ", data[idx][name]);
      }
    }
    console.warn("-------------");
  }

  return {lookup: lookup,
          insert: insert,
          replace: replace,
          begin_scope: begin_scope,
          end_scope: end_scope,
          display: display};
};

function IR(theAST) {

  var st = new SymbolTable();
  var vcnt = 0; // variable counter
  var str_cnt = 0;
  var name_cnt = 0;
  var expected_returned_type = 'NoTyp';

  function new_name(name) {
    return name + "_" + (name_cnt++) + "_";
  }

  function type_to_lltype(type) {
    switch (type) {
      case 'INTEGER': return "i32"; break;
      case 'REAL':    return "float"; break;
      case 'BOOLEAN': return "i1"; break;
      default: throw new Error("TODO: handle " + type + " return value");
    }
  }

  // normalizeIR takes a JSON IR
  function normalizeIR(ir) {
    var prefix = [], body = [];
    body.push("");
    for (var i=0; i < ir.length; i++) {
      if (typeof(ir[i]) === "object") {
        prefix.push.apply(prefix, ir[i]);
      } else {
        body.push(ir[i]);
      }
    }
    return (prefix.concat(body)).join("\n");
  }

  function toIR(astTree, level, fname) {
    var ast = astTree || theAST,
        indent = "",
        node = ast.node,
        ir = [];
    level = level ? level : 0;
    fname = fname ? fname : ast.id.toUpperCase();
    for (var i=0; i < level; i++) {
      indent = indent + "  ";
    }

    console.warn("toIR",node,"level:", level, "fname:", fname, "ast:", JSON.stringify(ast));

    switch (node) {
      case 'program':
        var name = ast.id,
            block = ast.block;
        st.insert('main', {name: name, level: level});

        ir.push("declare i32 @printf(i8*, ...)");
        ir.push("");
        ir.push('@.newline = private constant [2 x i8] c"\\0A\\00"');
        ir.push('@.true_str = private constant [5 x i8] c"TRUE\\00"');
        ir.push('@.false_str = private constant [6 x i8] c"FALSE\\00"');
        ir.push('@.str_format = private constant [3 x i8] c"%s\\00"');
        ir.push('@.int_format = private constant [3 x i8] c"%d\\00"');
        ir.push('@.float_format = private constant [3 x i8] c"%f\\00"');
        ir.push('');
        block.param_list = [];
        ir.push.apply(ir, toIR(block,level,'main'));
        break;

      case 'block':
        var decls = ast.decls,
            stmts = ast.stmts,
            param_list = ast.param_list;
        // Do sub-program declarations before the body definition
        for (var i=0; i < decls.length; i++) {
          var decl = decls[i];
          if (decl.node === 'proc_decl' || decl.node === 'func_decl') {
            ir.push.apply(ir, toIR(decl,level,fname));
          }
        }
        ir.push('');
        ir.push('define i32 @' + fname + '(' + param_list.join(", ") +') {');
        ir.push('entry:');
        // Do variable declarations inside the body definition
        for (var i=0; i < decls.length; i++) {
          var decl = decls[i];
          if (decl.node !== 'proc_decl' && decl.node !== 'func_decl') {
            ir.push.apply(ir, toIR(decl,level,fname));
          }
        }
        for (var i=0; i < stmts.length; i++) {
          ir.push.apply(ir, toIR(stmts[i],level,fname));
        }
        ir.push('  ret i32 0');
        ir.push('}');
        break;

      case 'var_decl':
        var id = ast.id,
            type = ast.type.toUpperCase(),
            pdecl = st.lookup(fname),
            sname = "%" + new_name(id + "_stack");

        lltype = type_to_lltype(type),
        st.insert(id,{node:'var_decl',type:type,sname:sname,level:pdecl.level});
        ir.push('  ' + sname + ' = alloca ' + lltype);
        break;

      case 'proc_decl':
        var id = ast.id,
            fparams = ast.fparams,
            block = ast.block,
            new_fname = new_name(id),
            new_level = level+1,
            param_list = [];

        st.insert(id, {name: new_fname, level: new_level,fparams:fparams});

        st.begin_scope();

        for (var i=0; i < fparams.length; i++) {
          var fparam = fparams[i],
              pname = "%" + new_name(fparam.id + "_fparam"),
              lltype = type_to_lltype(fparam.type);
          st.insert(fparam.id,{node:'var_decl',type:fparam.type,pname:pname,var:fparam.var,level:new_level});
          if (fparam.var) {
            param_list.push(lltype + '* ' + pname);
          } else {
            param_list.push(lltype + ' ' + pname);
          }
        }

        ir.push('');
        block.param_list = param_list;
        ir.push.apply(ir, toIR(block,level,new_fname));

        st.end_scope();
        break;

      case 'stmt_assign':
        var lvalue = ast.lvalue,
            expr = ast.expr
            lltype = null;
        ir.push.apply(ir,toIR(expr,level,fname));
        ir.push.apply(ir,toIR(lvalue,level,fname));
        ir.push('  store ' + expr.itype + ' ' + expr.ilocal + ', ' + lvalue.itype + '* ' + lvalue.istack);
        ast.itype = lvalue.itype;
        ast.istack = lvalue.istack;
        ast.ilocal = lvalue.ilocal;
        break;

      case 'stmt_call':
        var id = ast.id.toUpperCase(),
            cparams = (ast.call_params || []);
        switch (id) {
          case 'WRITE':
          case 'WRITELN':
            ir.push('  ; WRITELN start');
            for(var i=0; i < cparams.length; i++) {
              var param = cparams[i],
                  v = vcnt++,
                  format = null;
              ir.push.apply(ir, toIR(param,level,fname));
              switch (param.type) {
                case 'STRING':  format = "@.str_format"; break;
                case 'INTEGER': format = "@.int_format"; break;
                case 'REAL':    format = "@.float_format"; break;
                case 'BOOLEAN':
                  var br_name = new_name('br'),
                      br_true = br_name + '_true',
                      br_false = br_name + '_false',
                      br_done = br_name + '_done',
                      bool_local1 = '%' + new_name('bool_local'),
                      bool_local2 = '%' + new_name('bool_local'),
                      bool_local_out = '%' + new_name('bool_local');
                  ir.push('  br ' + param.itype + ' ' + param.ilocal + ', label %' + br_true + ', label %' + br_false);
                  ir.push('  ' + br_true + ':');
                  ir.push('    ' + bool_local1 + ' = getelementptr [5 x i8]* @.true_str, i32 0, i32 0'); 
                  ir.push('  br label %' + br_done); 
                  ir.push('  ' + br_false + ':');
                  ir.push('    ' + bool_local2 + ' = getelementptr [6 x i8]* @.false_str, i32 0, i32 0'); 
                  ir.push('  br label %' + br_done); 
                  ir.push('  ' + br_done + ':');
                  ir.push('  ' + bool_local_out + ' = phi i8* [ ' + bool_local1 + ', %' + br_true + '], [ ' + bool_local2 + ', %' + br_false + ']');
                  format = "@.str_format";
                  param.itype = 'i8*';
                  param.ilocal = bool_local_out;
                  break;
                default:
                  throw new Error("Unknown WRITE type: " + param.type);
              }
              ir.push('  %str' + v + ' = getelementptr inbounds [3 x i8]* ' + format + ', i32 0, i32 0');
              ir.push('  %call' + v + ' = call i32 (i8*, ...)* @printf(i8* %str' + v + ', ' +
                      param.itype + ' ' + param.ilocal + ')');
            }
            
            if (id === 'WRITELN') {
              v = vcnt++;
              ir.push('  %str' + v + ' = getelementptr inbounds [2 x i8]* @.newline, i32 0, i32 0');
              ir.push('  %call' + v + ' = call i32 (i8*, ...)* @printf(i8* %str' + v + ')');
            }
            ir.push('  ; WRITELN finish');
            break;
          default:
            var pdecl = st.lookup(id);
            if (!pdecl) {
              throw new Error("Unknown function '" + id + "'");
            }
            var fparams = pdecl.fparams,
                param_list = [];
            for(var i=0; i < cparams.length; i++) {
              var cparam = cparams[i];
              // TODO: make sure call params and formal params match
              // length and types
              ir.push.apply(ir, toIR(cparam,level,fname));
              if (fparams[i].var) {
                param_list.push(cparam.itype + "* " + cparam.istack);
              } else {
                param_list.push(cparam.itype + " " + cparam.ilocal);
              }
            }
            ir.push('  call i32 @' + pdecl.name + "(" + param_list.join(", ") + ")");
        }
        break;

      case 'stmt_compound':
        for (var i=0; i < ast.stmts.length; i++) {
          ir.push.apply(ir,toIR(ast.stmts[i],level,fname));
        }
        break;

      case 'stmt_if':
        var expr = ast.expr,
            tstmt = ast.tstmt,
            fstmt = ast.fstmt;
        ir.push('  ; if statement start');
        ir.push.apply(ir, toIR(expr,level,fname));
        var br_name = new_name('br'),
            br_true = br_name + '_true',
            br_false = br_name + '_false',
            br_done = br_name + '_done';
        ir.push('  br ' + expr.itype + ' ' + expr.ilocal + ', label %' + br_true + ', label %' + br_false);
        ir.push('  ' + br_true + ':');
        ir.push.apply(ir, toIR(tstmt,level,fname));
        ir.push('    br label %' + br_done); 
        ir.push('  ' + br_false + ':');
        ir.push.apply(ir, toIR(fstmt,level,fname));
        ir.push('    br label %' + br_done); 
        ir.push('  ' + br_done + ':');
        ir.push('  ; if statement finish');
        break;

      case 'expr_binop':
        var left = ast.left,
            right = ast.right,
            dest_name = '%' + new_name("binop"),
            lltype, rtype, ritype, op;
        ir.push.apply(ir, toIR(left,level,fname));
        ir.push.apply(ir, toIR(right,level,fname));
        // TODO: real typechecking comparison
        lltype = type_to_lltype(left.type);
        rtype = left.type;
        ritype = lltype;
        switch (ast.op) {
          case 'plus':  op = 'add'; break;
          case 'minus': op = 'sub'; break;
          case 'star':  op = 'mul'; break;
          case 'slash': op = 'sdiv'; break;  // float
          case 'div':   op = 'sdiv'; break;
          case 'mod':   op = 'urem'; break;

          case 'and':   op = 'and'; break;
          case 'or':    op = 'or'; break;

          case 'gt':    op = 'icmp sgt'; ritype = 'i1'; break;
          case 'lt':    op = 'icmp slt'; ritype = 'i1'; break;
          case 'eq':    op = 'icmp eq'; ritype = 'i1'; break;
          case 'geq':   op = 'icmp sge'; ritype = 'i1'; break;
          case 'leq':   op = 'icmp sle'; ritype = 'i1'; break;
          case 'neq':   op = 'icmp ne'; ritype = 'i1'; break;

          default: throw new Error("Unexpected expr_binop operand " + ast.op);
        }
        ir.push('  ' + dest_name + ' = ' + op + ' ' + lltype + ' ' + left.ilocal + ', ' + right.ilocal);
        ast.type = rtype;
        ast.itype = ritype;
        ast.ilocal = dest_name;
        break;

      case 'expr_unop':
        var expr = ast.expr,
            dest_name = '%' + new_name("unop"),
            op;
        ir.push.apply(ir, toIR(expr,level,fname));
        // TODO: real typechecking comparison
        switch (ast.op) {
          case 'minus':
            ir.push('  ' + dest_name + ' = sub i32 0, ' + expr.ilocal);
            break;
          default: throw new Error("Unexpected expr_unop operand " + ast.op);
        }
        ast.type = expr.type;
        ast.itype = expr.itype;
        ast.ilocal = dest_name;
        break;

      case 'integer':
        ast.itype = "i32";
        ast.ilocal = ast.val;
        break;
      case 'string':
        var sval = ast.val,
            slen = sval.length+1,
            sname = '@.string' + (str_cnt++),
            lname;
        ir.push([sname + ' = private constant [' + slen + ' x i8] c"' + sval + '\\00"']);
        ast.itype = '[' + slen + ' x i8]*';
        ast.ilocal = sname;
        ast.iref = sname;
        break;

      case 'variable':
        switch (ast.id.toUpperCase()) {
          case 'TRUE': ast.itype = "i1"; ast.ilocal = "true"; break;
          case 'FALSE': ast.itype = "i1"; ast.ilocal = "false"; break;
          //case 'NIL': ast.rettype = "i32*"; ast.retref = "null"; break;
          default:
            var vdecl = st.lookup(ast.id),
                lltype = type_to_lltype(vdecl.type) ;
            ast.type = vdecl.type;
            ast.itype = lltype;
            if (vdecl.pname) {
              // parameter register/variable
              if (vdecl.var) {
                ast.ilocal = vdecl.pname;
                ast.istack = vdecl.pname;
              } else {
                var sname = "%" + new_name(ast.id + "_stack");
                ast.ilocal = vdecl.pname;
                ast.istack = sname;
                ir.push('  ' + sname + ' = alloca ' + lltype);
                ir.push('  store ' + lltype + ' ' + vdecl.pname + ', ' + lltype + '* ' + sname);
              }
            } else {
              // stack variable
              var lname = "%" + new_name(ast.id + "_local");
              ast.ilocal = lname;
              ast.istack = vdecl.sname;
              ir.push('  ' + lname + ' = load ' + lltype + '* ' + vdecl.sname);
            }
        }
        break;

      default:
        throw new Error("Unknown AST: " + JSON.stringify(ast));
    }

    return ir;
  }

  return {toIR: toIR, normalizeIR: normalizeIR,
          displayST: function() { st.display(); },
          getAST: function() { return theAST; }};
}

exports.IR = IR;
exports.toIR = function (ast) {
  var ir = new IR(ast);
  return ir.normalizeIR(ir.toIR());
};
if (typeof module !== 'undefined' && require.main === module) {
  var ast = require('./parse').main(process.argv.slice(1));
  console.log(exports.toIR(ast));
}

// vim: expandtab:ts=2:sw=2:syntax=javascript
